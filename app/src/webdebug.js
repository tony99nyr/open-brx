// B21 (Tony 2026-09-25/26): WebView debugging is a switch in the diagnostics panel, default on while
// MVP features are still being built. Android and iOS 16.4+ each own the stored value and apply it at
// start (BrxDebugPlugin.java / BrxDebugPlugin.swift); this module only reads it and flips it. The
// browser stage has no plugin at all: `state` stays null and the panel hides the switch. An iOS build
// below 16.4 (no `isInspectable`) or a native call that fails reports `state === 'unsupported'`: a real
// switch this OS/build cannot offer, shown as UNSUPPORTED rather than as an error.
import { Capacitor } from '@capacitor/core';
import { BrxDebug } from '../plugins/brx-debug/src/index.js';

/** @typedef {{enabled:boolean, forced?:boolean, supported?:boolean}} DebugState */
/** @typedef {{get():Promise<DebugState>, set(o:{enabled:boolean}):Promise<DebugState>}} DebugPlugin */

export class WebDebug {
  /** @param {{capacitor?: any, plugin?: DebugPlugin}} [o] */
  constructor({ capacitor = Capacitor, plugin = BrxDebug } = {}) {
    this.plugin = capacitor.isPluginAvailable('BrxDebug') ? plugin : null;
    /** @type {boolean|'unsupported'|null} null = no switch on this platform (or not read yet) */
    this.state = null;
    /** true on a debuggable APK, which is always inspectable, so the switch cannot turn it off */
    this.forced = false;
    this.busy = false;
  }

  /** Read the stored value once at start. */
  async load() {
    if (!this.plugin) return null;
    try {
      const r = await this.plugin.get();
      if (r.supported === false) { this.state = 'unsupported'; this.forced = false; return this.state; }
      this.state = !!r.enabled; this.forced = !!r.forced;
    } catch { this.state = 'unsupported'; this.forced = false; }
    return this.state;
  }

  /** Flip the switch. Returns the value the phone now holds. */
  async toggle() {
    if (!this.plugin || this.busy || this.forced || this.state === null || this.state === 'unsupported') return this.state;
    this.busy = true;
    try {
      const r = await this.plugin.set({ enabled: !this.state });
      if (r.supported === false) { this.state = 'unsupported'; this.forced = false; }
      else { this.state = !!r.enabled; this.forced = !!r.forced; }
    } catch { this.state = 'unsupported'; this.forced = false; }
    finally { this.busy = false; }
    return this.state;
  }
}
