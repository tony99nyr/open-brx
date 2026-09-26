import Foundation
import WebKit
import Capacitor

/**
 * B21: WebView debugging switch, iOS half. UserDefaults holds the phone's stored choice; `load()`
 * applies it to the Capacitor WKWebView through `isInspectable` before the page runs, same shape as
 * the Android plugin (BrxDebugPlugin.java: SharedPreferences + `WebView.setWebContentsDebuggingEnabled`).
 *
 * `isInspectable` needs iOS 16.4 (WWDC 2023); the bench phone (an iPhone X) is on iOS 16.x, which may
 * sit below that floor. Below it there is no such switch on this OS, so `get`/`set` report
 * `supported: false` rather than pretending the toggle did something. The JS side (app/src/webdebug.js)
 * treats that as its own state, `'unsupported'`, distinct from `enabled`/`disabled`, and the ⓘ panel's
 * DEVELOPER row shows it as UNSUPPORTED with the button disabled, never as an error.
 *
 * Uncompiled: this repo builds Swift only on a MacBook (no Xcode on this box), so treat this file as
 * reviewed-but-unverified until an iOS build exercises it (`iphone-build` skill).
 */
@objc(BrxDebugPlugin)
public class BrxDebugPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BrxDebugPlugin"
    public let jsName = "BrxDebug"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    // Matches Android's DEFAULT_ON (BrxDebugPlugin.java): on while MVP features are still being built.
    // Flip both for a public release.
    static let defaultOn = true
    private let key = "brx_debug_webview_debugging"

    private var supported: Bool {
        if #available(iOS 16.4, *) { return true }
        return false
    }

    private func stored() -> Bool {
        let d = UserDefaults.standard
        if d.object(forKey: key) == nil { return BrxDebugPlugin.defaultOn }
        return d.bool(forKey: key)
    }

    private func apply(_ on: Bool) {
        guard #available(iOS 16.4, *) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.bridge?.webView?.isInspectable = on
        }
    }

    private func state() -> [String: Any] {
        let sup = supported
        return [
            "enabled": sup && stored(),
            "forced": false,
            "defaultOn": BrxDebugPlugin.defaultOn,
            "supported": sup
        ]
    }

    override public func load() {
        if supported { apply(stored()) }
    }

    @objc func get(_ call: CAPPluginCall) {
        call.resolve(state())
    }

    @objc func set(_ call: CAPPluginCall) {
        guard supported else { call.resolve(state()); return }
        guard let on = call.getBool("enabled") else { call.reject("enabled (boolean) is required"); return }
        UserDefaults.standard.set(on, forKey: key)
        apply(on)
        call.resolve(state())
    }
}
