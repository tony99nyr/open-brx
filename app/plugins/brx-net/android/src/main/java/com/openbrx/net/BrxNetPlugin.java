package com.openbrx.net;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/** WebSockets to LAN targets use Wi-Fi even when Android selects mobile data as the default route. */
@CapacitorPlugin(name = "BrxNet")
public class BrxNetPlugin extends Plugin {
    // A 10 s ping so a live Wi-Fi with a frozen Mission Control ends in onFailure and a redial, not silence.
    private final OkHttpClient defaultClient = new OkHttpClient.Builder().pingInterval(10, TimeUnit.SECONDS).build();
    private final ConcurrentHashMap<String, SocketRecord> sockets = new ConcurrentHashMap<>();
    private volatile boolean destroyed = false;
    // The Wi-Fi network we HOLD (one joined Wi-Fi is assumed; a make-before-break switch moves it). A request (not a lookup) keeps Android from tearing down a no-internet
    // Wi-Fi it thinks nobody needs, and it names the Wi-Fi network itself, never a VPN over it.
    private volatile Network heldWifi = null;
    private ConnectivityManager.NetworkCallback wifiCallback = null;

    @Override
    public void load() {
        super.load();
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return;
        NetworkRequest request = new NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)   // the field Wi-Fi has none
            .build();
        wifiCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { heldWifi = network; }
            @Override public void onLost(Network network) { if (network.equals(heldWifi)) heldWifi = null; }
        };
        try { manager.requestNetwork(request, wifiCallback); } catch (RuntimeException e) { wifiCallback = null; }
    }

    private static final class SocketRecord {
        final String id;
        final AtomicBoolean closed = new AtomicBoolean(false);
        final AtomicBoolean opened = new AtomicBoolean(false);
        volatile WebSocket socket;

        SocketRecord(String id) { this.id = id; }
    }

    private static boolean isLanHost(String host) {
        if (host == null) return false;
        String lower = host.toLowerCase(Locale.ROOT);
        if (lower.startsWith("[") && lower.endsWith("]")) lower = lower.substring(1, lower.length() - 1);
        if (lower.endsWith(".")) lower = lower.substring(0, lower.length() - 1);
        if (lower.endsWith(".local")) return true;

        String[] octets = lower.split("\\.", -1);
        if (octets.length == 4) {
            int[] ip = new int[4];
            boolean ipv4 = true;
            for (int i = 0; i < 4; i++) {
                if (octets[i].isEmpty() || octets[i].length() > 3) { ipv4 = false; break; }
                for (int j = 0; j < octets[i].length(); j++) {
                    if (!Character.isDigit(octets[i].charAt(j))) { ipv4 = false; break; }
                }
                if (!ipv4) break;
                ip[i] = Integer.parseInt(octets[i]);
                if (ip[i] > 255) { ipv4 = false; break; }
            }
            if (ipv4) return ip[0] == 10
                || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31)
                || (ip[0] == 192 && ip[1] == 168)
                || (ip[0] == 169 && ip[1] == 254);
        }

        if (lower.indexOf(':') < 0) return false;
        try {
            InetAddress address = InetAddress.getByName(lower);
            if (!(address instanceof Inet6Address)) return false;
            byte[] bytes = address.getAddress();
            return (bytes[0] & 0xfe) == 0xfc
                || ((bytes[0] & 0xff) == 0xfe && (bytes[1] & 0xc0) == 0x80);
        } catch (Exception ignored) {
            return false;
        }
    }

    private Network wifiNetwork() {
        Network held = heldWifi;
        if (held != null) return held;
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return null;
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return network;
        }
        return null;
    }

    private OkHttpClient clientFor(Network wifi) {
        if (wifi == null) return defaultClient;
        Dns dns = hostname -> Arrays.asList(wifi.getAllByName(hostname));
        return defaultClient.newBuilder()
            .socketFactory(wifi.getSocketFactory())
            .dns(dns)
            .proxy(Proxy.NO_PROXY)
            .build();
    }

    // Every event goes out on the plugin thread, the thread that runs addListener/removeListener. OkHttp calls
    // back on its own threads, and Capacitor's listener list is not thread-safe: a socket failing while the JS side
    // swapped listeners hit a null PluginCall inside notifyListeners and killed the app (bench 2026-09-24, an MC
    // reconnect loop). Bridge.execute keeps the order of the events.
    private void emit(String event, JSObject payload) {
        if (destroyed) return;
        getBridge().execute(() -> { if (!destroyed) notifyListeners(event, payload); });
    }

    private void finish(SocketRecord record, int code, String reason) {
        if (!record.closed.compareAndSet(false, true)) return;
        sockets.remove(record.id, record);
        JSObject payload = new JSObject();
        payload.put("id", record.id);
        payload.put("code", code);
        payload.put("reason", reason == null ? "" : reason);
        emit("close", payload);
    }

    @PluginMethod
    public void open(PluginCall call) {
        if (destroyed) { call.reject("plugin destroyed"); return; }
        String url = call.getString("url");
        if (url == null) { call.reject("url required"); return; }
        URI uri;
        try {
            uri = URI.create(url);
            String scheme = uri.getScheme();
            if (uri.getHost() == null || !("ws".equalsIgnoreCase(scheme) || "wss".equalsIgnoreCase(scheme))) {
                call.reject("invalid WebSocket URL"); return;
            }
        } catch (IllegalArgumentException e) {
            call.reject("invalid WebSocket URL", e); return;
        }

        Network wifi = isLanHost(uri.getHost()) ? wifiNetwork() : null;
        String id = UUID.randomUUID().toString();
        SocketRecord record = new SocketRecord(id);
        sockets.put(id, record);
        try {
            Request request = new Request.Builder().url(url).build();
            record.socket = clientFor(wifi).newWebSocket(request, new WebSocketListener() {
                @Override public void onOpen(WebSocket socket, Response response) {
                    if (record.closed.get()) { socket.cancel(); return; }
                    record.opened.set(true);
                    JSObject payload = new JSObject();
                    payload.put("id", id);
                    emit("open", payload);
                }

                @Override public void onMessage(WebSocket socket, String text) {
                    if (record.closed.get()) return;
                    JSObject payload = new JSObject();
                    payload.put("id", id);
                    payload.put("data", text);
                    emit("message", payload);
                }

                @Override public void onMessage(WebSocket socket, ByteString bytes) {
                    if (record.closed.get()) return;
                    JSObject payload = new JSObject();
                    payload.put("id", id);
                    payload.put("message", "binary WebSocket messages are unsupported");
                    emit("error", payload);
                }

                // Answer the peer's close so the handshake completes and onClosed carries MC's code (a
                // 4001/4003 refusal is how the transport learns to stop redialling).
                @Override public void onClosing(WebSocket socket, int code, String reason) {
                    // 1005 (no status) and other unsendable codes cannot be echoed; answer 1000.
                    boolean sendable = code == 1000 || (code >= 3000 && code <= 4999);
                    socket.close(sendable ? code : 1000, sendable ? reason : "");
                }

                @Override public void onClosed(WebSocket socket, int code, String reason) {
                    finish(record, code, reason);
                }

                @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                    if (record.closed.get()) return;
                    JSObject payload = new JSObject();
                    payload.put("id", id);
                    payload.put("message", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
                    emit("error", payload);
                    finish(record, 1006, "");
                }
            });
            JSObject result = new JSObject();
            result.put("id", id);
            result.put("network", wifi == null ? "default" : "wifi");
            call.resolve(result);
        } catch (Exception e) {
            record.closed.set(true);
            if (record.socket != null) record.socket.cancel();
            sockets.remove(id, record);
            call.reject("WebSocket open failed", e);
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        SocketRecord record = id == null ? null : sockets.get(id);
        if (record == null || record.closed.get() || record.socket == null) { call.reject("socket is closed"); return; }
        if (data == null) { call.reject("data required"); return; }
        if (!record.socket.send(data)) { call.reject("socket is closing"); return; }
        JSObject result = new JSObject();
        result.put("queued", record.socket.queueSize());   // backpressure for the log upload (bufferedAmount)
        call.resolve(result);
    }

    /** The bytes OkHttp still holds for this socket, so the JS side can drain a log upload honestly. */
    @PluginMethod
    public void queued(PluginCall call) {
        String id = call.getString("id");
        SocketRecord record = id == null ? null : sockets.get(id);
        JSObject result = new JSObject();
        result.put("queued", record == null || record.socket == null ? 0L : record.socket.queueSize());
        call.resolve(result);
    }

    @PluginMethod
    public void close(PluginCall call) {
        String id = call.getString("id");
        SocketRecord record = id == null ? null : sockets.get(id);
        if (record == null || record.closed.get() || record.socket == null) { call.resolve(); return; }
        Integer requestedCode = call.getInt("code");
        int code = requestedCode == null ? 1000 : requestedCode;
        String reason = call.getString("reason", "");
        if (reason == null) reason = "";
        // Clamp rather than reject: a rejected close left the native socket open and MC holding the session.
        if (code != 1000 && (code < 3000 || code > 4999)) code = 1000;
        if (reason.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 123) reason = "";
        if (!record.opened.get()) {
            record.socket.cancel();
            finish(record, 1006, "");
        } else if (!record.socket.close(code, reason)) {
            finish(record, code, reason);
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager != null && wifiCallback != null) {
            try { manager.unregisterNetworkCallback(wifiCallback); } catch (RuntimeException ignored) { }
        }
        for (SocketRecord record : sockets.values()) {
            record.closed.set(true);
            if (record.socket != null) record.socket.cancel();
        }
        sockets.clear();
        defaultClient.dispatcher().executorService().shutdown();
        defaultClient.connectionPool().evictAll();
        super.handleOnDestroy();
    }
}
