// B21 (Tony 2026-09-25): WebView debugging is a switch in the diagnostics panel, default on while MVP
// features are still being built. The Android plugin owns the stored value and applies it at start;
// this module only reads it and flips it. iOS and the browser stage have no plugin: `state` stays null
// and the panel hides the switch. The iOS half (WKWebView `isInspectable`) is still open on B21.
import { Capacitor } from '@capacitor/core';
import { BrxDebug } from '../plugins/brx-debug/src/index.js';

/** @typedef {{enabled:boolean, forced?:boolean}} DebugState */
/** @typedef {{get():Promise<DebugState>, set(o:{enabled:boolean}):Promise<DebugState>}} DebugPlugin */

export class WebDebug {
  /** @param {{capacitor?: any, plugin?: DebugPlugin}} [o] */
  constructor({ capacitor = Capacitor, plugin = BrxDebug } = {}) {
    this.plugin = capacitor.getPlatform() === 'android' && capacitor.isPluginAvailable('BrxDebug') ? plugin : null;
    /** @type {boolean|null} null = no switch on this platform (or not read yet) */
    this.state = null;
    /** true on a debuggable APK, which is always inspectable, so the switch cannot turn it off */
    this.forced = false;
    this.busy = false;
  }

  /** Read the stored value once at start. */
  async load() {
    if (!this.plugin) return null;
    const r = await this.plugin.get();
    this.state = !!r.enabled; this.forced = !!r.forced;
    return this.state;
  }

  /** Flip the switch. Returns the value the phone now holds. */
  async toggle() {
    if (!this.plugin || this.busy || this.forced || this.state === null) return this.state;
    this.busy = true;
    try {
      const r = await this.plugin.set({ enabled: !this.state });
      this.state = !!r.enabled; this.forced = !!r.forced;
    } finally { this.busy = false; }
    return this.state;
  }
}
