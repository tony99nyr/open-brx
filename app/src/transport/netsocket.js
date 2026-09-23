import { Capacitor } from '@capacitor/core';
import { BrxNet } from '../../plugins/brx-net/src/index.js';

/** @typedef {{id:string, data?:string, code?:number, reason?:string, message?:string}} NativeEvent */
/** @typedef {{remove():Promise<void>}} ListenerHandle */
/** @typedef {{open(options:{url:string}):Promise<{id:string, network:string}>, send(options:{id:string,data:string}):Promise<unknown>, queued?(options:{id:string}):Promise<unknown>, close(options:{id:string,code?:number,reason?:string}):Promise<unknown>, addListener(name:string, callback:(event:NativeEvent)=>void):Promise<ListenerHandle>}} NetPlugin */

/** A text WebSocket backed by BrxNet. Native events can arrive before open() returns its id. */
export class NetSocket {
  /** @param {string} url @param {NetPlugin} plugin */
  constructor(url, plugin) {
    this.url = url;
    this.readyState = 0;
    this.bufferedAmount = 0;
    /** @type {((event:any)=>void)|null} */ this.onopen = null;
    /** @type {((event:any)=>void)|null} */ this.onmessage = null;
    /** @type {((event:any)=>void)|null} */ this.onclose = null;
    /** @type {((event:any)=>void)|null} */ this.onerror = null;
    /** @type {string|null} */ this.id = null;
    this.plugin = plugin;
    /** @type {ListenerHandle[]} */ this.listeners = [];
    /** @type {{name:string,event:NativeEvent}[]} */ this.early = [];
    this.closeCode = 1000;
    this.closeReason = '';
    /** @type {ReturnType<typeof setTimeout>|null} */ this.queuedTimer = null;
    this.queuedAsked = 0; this.queuedApplied = 0;   // an older answer must never overwrite a newer one
    // Give callers time to install handlers, as a browser WebSocket does.
    queueMicrotask(() => { void this.start(); });
  }

  async start() {
    try {
      for (const name of ['open', 'message', 'close', 'error']) {
        this.listeners.push(await this.plugin.addListener(name, event => this.receive(name, event)));
      }
      if (this.readyState >= 2) { this.finishClose(this.closeCode, this.closeReason); return; }   // closed before it dialled
      const result = await this.plugin.open({ url: this.url });
      this.id = result.id;
      const early = this.early;
      this.early = [];
      for (const { name, event } of early) if (event.id === this.id) this.deliver(name, event);
      if (this.readyState === 2) void this.plugin.close({ id: this.id, code: this.closeCode, reason: this.closeReason }).catch(() => this.finishClose(1006, ''));
    } catch (error) {
      if (this.readyState === 3) return;
      this.onerror?.({ error });
      this.finishClose(1006, '');
    }
  }

  /** @param {string} name @param {NativeEvent} event */
  receive(name, event) {
    if (this.id === null) { this.early.push({ name, event }); return; }
    if (event.id === this.id) this.deliver(name, event);
  }

  /** @param {string} name @param {NativeEvent} event */
  deliver(name, event) {
    if (this.readyState === 3) return;
    if (name === 'open' && this.readyState === 0) { this.readyState = 1; this.onopen?.({}); }
    else if (name === 'message' && this.readyState === 1) this.onmessage?.({ data: event.data || '' });
    else if (name === 'error') this.onerror?.({ error: event.message || 'WebSocket error' });
    else if (name === 'close') this.finishClose(event.code ?? 1006, event.reason || '');
  }

  /** @param {number} code @param {string} reason */
  finishClose(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.early = [];
    if (this.queuedTimer) { clearTimeout(this.queuedTimer); this.queuedTimer = null; }
    for (const listener of this.listeners.splice(0)) void listener.remove();
    this.onclose?.({ code, reason });
  }

  /** @param {string} data */
  send(data) {
    if (this.readyState === 0) throw new DOMException('WebSocket is still connecting', 'InvalidStateError');
    if (this.readyState !== 1 || this.id === null) return;
    this.bufferedAmount += data.length;   // until native answers with OkHttp's own queue size
    const n = ++this.queuedAsked;
    void this.plugin.send({ id: this.id, data })
      .then(r => this.noteQueued(r, n))
      .catch(error => this.onerror?.({ error }));
  }

  /** Take native's queue size; while bytes are still queued, ask again every 100 ms so a log upload's
   *  drain (logsync `_drain`) sees the queue empty when it does, not at the next send.
   *  @param {unknown} r @param {number} n the ask this answers */
  noteQueued(r, n) {
    const q = r && typeof r === 'object' ? /** @type {{queued?:unknown}} */ (r).queued : undefined;
    if (typeof q !== 'number' || n < this.queuedApplied) return;
    this.queuedApplied = n;
    this.bufferedAmount = q;
    if (q > 0 && !this.queuedTimer && this.plugin.queued && this.readyState === 1) {
      this.queuedTimer = setTimeout(() => {
        this.queuedTimer = null;
        if (this.readyState !== 1 || this.id === null || !this.plugin.queued) return;
        const m = ++this.queuedAsked;
        void this.plugin.queued({ id: this.id }).then(x => this.noteQueued(x, m)).catch(() => { /* next send refreshes it */ });
      }, 100);
    }
  }

  /** @param {number} [code] @param {string} [reason] */
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.closeCode = code;
    this.closeReason = reason;
    if (this.id !== null) void this.plugin.close({ id: this.id, code, reason }).catch(() => this.finishClose(1006, ''));
  }
}

/** @param {{capacitor?:typeof Capacitor, plugin?:NetPlugin, WebSocketCtor?:typeof WebSocket}} [options] */
export function makeWsFactory({ capacitor = Capacitor, plugin = BrxNet, WebSocketCtor = undefined } = {}) {
  if (capacitor.getPlatform() === 'android' && capacitor.isPluginAvailable('BrxNet')) {
    return (/** @type {string} */ url) => new NetSocket(url, plugin);
  }
  // Resolved per call, as `new WebSocket(url)` was, so a harness that swaps the global still reaches it.
  return (/** @type {string} */ url) => new (WebSocketCtor || globalThis.WebSocket)(url);
}
