package com.openbrx.debug;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * B21: WebView debugging (chrome://inspect, the CDP forward) is a switch on the phone, not a build choice.
 * Capacitor applies `webContentsDebuggingEnabled` from capacitor.config.json when it builds the WebView;
 * plugins load after that, so load() applies the stored choice before the page runs. The switch is
 * process-wide and takes effect at once. Flip DEFAULT_ON to false for a public release.
 */
@CapacitorPlugin(name = "BrxDebug")
public class BrxDebugPlugin extends Plugin {
    static final boolean DEFAULT_ON = true;   // Tony 2026-09-25: on while MVP features are still being built
    private static final String PREFS = "brx_debug";
    private static final String KEY = "webview_debugging";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean stored() { return prefs().getBoolean(KEY, DEFAULT_ON); }

    private void apply(boolean on) {
        getActivity().runOnUiThread(() -> WebView.setWebContentsDebuggingEnabled(on));
    }

    /** A debuggable APK (the `android:apk` debug build) is always inspectable: Chromium ignores OFF there. */
    private boolean forced() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private JSObject state() {
        JSObject out = new JSObject();
        out.put("enabled", forced() || stored());
        out.put("forced", forced());
        out.put("defaultOn", DEFAULT_ON);
        return out;
    }

    @Override
    public void load() {
        super.load();
        apply(stored());
    }

    @PluginMethod
    public void get(PluginCall call) { call.resolve(state()); }

    @PluginMethod
    public void set(PluginCall call) {
        Boolean on = call.getBoolean("enabled");
        if (on == null) { call.reject("enabled (boolean) is required"); return; }
        prefs().edit().putBoolean(KEY, on).apply();
        apply(on);
        call.resolve(state());
    }
}
