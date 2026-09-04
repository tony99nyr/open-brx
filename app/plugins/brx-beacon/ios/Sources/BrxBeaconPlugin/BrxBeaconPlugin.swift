import Foundation
import CoreBluetooth
import Capacitor

/**
 * Advertise one 128-bit service UUID (plus an optional local name) until stop().
 * iOS lets an app set ONLY those two advert fields and gives no transmit-power control, so the
 * radius knob on an iPhone station is the receiver-side RSSI threshold alone (docs/spec/utility.md §3).
 * Foreground only: in the background iOS moves service UUIDs into the overflow area and drops the name.
 */
@objc(BrxBeaconPlugin)
public class BrxBeaconPlugin: CAPPlugin, CAPBridgedPlugin, CBPeripheralManagerDelegate {
    public let identifier = "BrxBeaconPlugin"
    public let jsName = "BrxBeacon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CBPeripheralManager?
    private var pending: (data: [String: Any], call: CAPPluginCall)?
    private var startCall: CAPPluginCall?
    private var currentUuid: String?

    private func ensureManager() -> CBPeripheralManager {
        if let m = manager { return m }
        let m = CBPeripheralManager(delegate: self, queue: nil, options: [CBPeripheralManagerOptionShowPowerAlertKey: true])
        manager = m
        return m
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        let m = ensureManager()
        call.resolve([
            "advertising": m.state == .poweredOn || m.state == .unknown,
            "txPowerControl": false,
            "platform": "ios"
        ])
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve([
            "advertising": manager?.isAdvertising ?? false,
            "uuid": currentUuid as Any,
            "txPower": NSNull()
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let uuid = call.getString("uuid") else { call.reject("uuid required"); return }
        var data: [String: Any] = [CBAdvertisementDataServiceUUIDsKey: [CBUUID(string: uuid)]]
        if let name = call.getString("name"), !name.isEmpty { data[CBAdvertisementDataLocalNameKey] = name }
        let m = ensureManager()
        currentUuid = uuid
        if m.state == .poweredOn {
            if m.isAdvertising { m.stopAdvertising() }
            startCall = call
            m.startAdvertising(data)
        } else {
            // Held until poweredOn. If a second start() arrives inside the power-up window (an alive→down UUID
            // change does exactly that), resolve the superseded call rather than leaking its promise forever.
            if let old = pending { old.call.reject("superseded by a newer start") }
            pending = (data, call)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        manager?.stopAdvertising()
        currentUuid = nil
        call.resolve(["ok": true])
    }

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if let p = pending {
            pending = nil
            if peripheral.state == .poweredOn {
                startCall = p.call
                peripheral.startAdvertising(p.data)
            } else {
                p.call.reject("bluetooth not available (state \(peripheral.state.rawValue))")
            }
            return
        }
        // No call waiting: BT was toggled while we were advertising. On power-off the OS stopped the advert;
        // on power-on, re-assert it from the last uuid so a mid-match Bluetooth blip self-heals.
        if peripheral.state == .poweredOn, let uuid = currentUuid, !peripheral.isAdvertising {
            peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [CBUUID(string: uuid)]])
        }
    }

    public func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        guard let call = startCall else { return }
        startCall = nil
        if let e = error { call.reject("advertise failed: \(e.localizedDescription)"); return }
        call.resolve([
            "ok": true,
            "advertising": true,
            "uuid": currentUuid as Any,
            "txPower": NSNull(),
            "txPowerControl": false
        ])
    }
}
