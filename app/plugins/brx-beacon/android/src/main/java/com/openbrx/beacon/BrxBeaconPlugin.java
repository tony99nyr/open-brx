package com.openbrx.beacon;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.Build;
import android.os.ParcelUuid;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.UUID;

/**
 * Advertise one 128-bit service UUID, non-connectable, until stop(). This is the "utility item" identity
 * broadcast (docs/spec/utility.md): the phone is a respawn station / powerup / extraction point / bomb
 * site, and every player phone reads its kind, team and state from the scan without connecting.
 *
 * Transmit power is the radius knob. Android exposes four levels (ULTRA_LOW ~ -21 dBm ... HIGH ~ +1 dBm);
 * iOS exposes none, so the JS side treats `txPowerControl` as a capability, not a given.
 */
@CapacitorPlugin(
    name = "BrxBeacon",
    permissions = {
        @Permission(alias = "advertise", strings = { Manifest.permission.BLUETOOTH_ADVERTISE }),
    }
)
public class BrxBeaconPlugin extends Plugin {

    private BluetoothLeAdvertiser advertiser;
    private AdvertiseCallback callback;
    // written on the main thread (doStart callback), read by status()/isSupported() on the bridge thread
    private volatile boolean advertising = false;
    private volatile String currentUuid = null;
    private volatile String currentTx = null;

    private BluetoothLeAdvertiser advertiserOrNull() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm == null) return null;
        BluetoothAdapter ad = bm.getAdapter();
        if (ad == null || !ad.isEnabled()) return null;
        return ad.getBluetoothLeAdvertiser(); // null when the chip cannot advertise
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
        boolean can = ad != null && ad.isEnabled() && ad.getBluetoothLeAdvertiser() != null;
        ret.put("advertising", can);
        ret.put("txPowerControl", can);
        ret.put("platform", "android");
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("advertising", advertising);
        ret.put("uuid", currentUuid);
        ret.put("txPower", currentTx);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("advertise") != PermissionState.GRANTED) {
            requestPermissionForAlias("advertise", call, "advertisePermissionCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void advertisePermissionCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("advertise") != PermissionState.GRANTED) {
            call.reject("BLUETOOTH_ADVERTISE permission denied");
            return;
        }
        doStart(call);
    }

    private static int txLevel(String s) {
        if (s == null) return AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM;
        switch (s) {
            case "ultraLow": return AdvertiseSettings.ADVERTISE_TX_POWER_ULTRA_LOW;
            case "low": return AdvertiseSettings.ADVERTISE_TX_POWER_LOW;
            case "high": return AdvertiseSettings.ADVERTISE_TX_POWER_HIGH;
            default: return AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM;
        }
    }

    private static int advMode(String s) {
        if (s == null) return AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY;
        switch (s) {
            case "lowPower": return AdvertiseSettings.ADVERTISE_MODE_LOW_POWER;
            case "balanced": return AdvertiseSettings.ADVERTISE_MODE_BALANCED;
            default: return AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY;
        }
    }

    private void doStart(final PluginCall call) {
        final String uuid = call.getString("uuid");
        if (uuid == null) { call.reject("uuid required"); return; }
        final UUID parsed;
        try { parsed = UUID.fromString(uuid); } catch (IllegalArgumentException e) { call.reject("bad uuid: " + uuid); return; }
        final String tx = call.getString("txPower", "medium");
        final String mode = call.getString("mode", "lowLatency");
        final boolean includeTx = Boolean.TRUE.equals(call.getBoolean("includeTxPower", true));

        getBridge().executeOnMainThread(() -> {
            stopInternal();
            advertiser = advertiserOrNull();
            if (advertiser == null) { call.reject("this device cannot advertise (adapter off or no LE advertiser)"); return; }
            AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(advMode(mode))
                .setTxPowerLevel(txLevel(tx))
                .setConnectable(false)
                .setTimeout(0)
                .build();
            // flags(3) + 128-bit uuid(18) [+ tx power(3)] fits the 31-byte legacy advert; the device name would not.
            AdvertiseData data = new AdvertiseData.Builder()
                .addServiceUuid(new ParcelUuid(parsed))
                .setIncludeDeviceName(false)
                .setIncludeTxPowerLevel(includeTx)
                .build();
            callback = new AdvertiseCallback() {
                @Override public void onStartSuccess(AdvertiseSettings s) {
                    advertising = true; currentUuid = uuid; currentTx = tx;
                    JSObject ret = new JSObject();
                    ret.put("ok", true); ret.put("advertising", true); ret.put("uuid", uuid); ret.put("txPower", tx);
                    ret.put("txPowerControl", true);
                    call.resolve(ret);
                }
                @Override public void onStartFailure(int code) {
                    advertising = false;
                    String why;
                    switch (code) {
                        case ADVERTISE_FAILED_DATA_TOO_LARGE: why = "data too large"; break;
                        case ADVERTISE_FAILED_TOO_MANY_ADVERTISERS: why = "too many advertisers"; break;
                        case ADVERTISE_FAILED_ALREADY_STARTED: why = "already started"; break;
                        case ADVERTISE_FAILED_FEATURE_UNSUPPORTED: why = "feature unsupported"; break;
                        default: why = "internal error " + code;
                    }
                    call.reject("advertise failed: " + why);
                }
            };
            try {
                advertiser.startAdvertising(settings, data, callback);
            } catch (SecurityException e) {
                call.reject("advertise permission missing: " + e.getMessage());
            }
        });
    }

    private void stopInternal() {
        if (advertiser != null && callback != null) {
            try { advertiser.stopAdvertising(callback); } catch (Exception ignored) { /* adapter may be off */ }
        }
        callback = null; advertising = false; currentUuid = null; currentTx = null;
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            stopInternal();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        });
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
    }
}
