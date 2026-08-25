// BRX — 2-tagger deathmatch. Connects TWO guns from one phone, arms them, and runs
// the host-driven game: damage tracking (from $HP/$LCD/$ALCD), death + kill
// attribution (victim's last $HIR shooter team), host respawn, and kill feedback
// ($SFLASH + $PLAY V3A). Native BLE via @capacitor-community/bluetooth-le.
import { BleClient, textToDataView, dataViewToText } from '@capacitor-community/bluetooth-le';

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const KILL_LINE = 'V3A';           // "kill" (confirmed, sound-bank)
const ATTRIB_FUSE = 6000, MULTI_WIN = 4000, MAX_HP = 45, MAX_AR = 70;

// team-independent config, then per-team spawn (from gameconfig TDM, vol 69)
const SETUP = [
  "$VOL,69,0,*","$CLEAR,*","$START,*","$GSET,1,0,1,0,1,0,50,1,*",
  "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*",
  "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*",
  "$WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*",
  "$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*",
  "$SIR,0,0,,1,0,0,1,,*","$SIR,0,1,,36,0,0,1,,*","$SIR,0,3,,37,0,0,1,,*","$SIR,8,0,,38,0,0,1,,*",
  "$SIR,9,3,,24,10,0,,,*","$SIR,10,0,X13,1,0,100,2,60,*","$SIR,6,0,H02,1,0,90,1,40,*",
  "$SIR,13,1,H57,1,0,0,1,,*","$SIR,13,0,H50,1,0,0,1,,*","$SIR,13,3,H49,1,0,100,0,60,*",
  "$BMAP,0,0,,,,,*","$BMAP,1,100,0,1,99,99,*","$BMAP,2,97,,,,,*","$BMAP,3,98,,,,,*",
  "$BMAP,4,98,,,,,*","$BMAP,5,98,,,,,*","$BMAP,8,4,,,,,*","$PLAYX,0,*","$PLAY,VA81,4,6,,,,,*"
];
const spawnFrames = team => [`$TID,${team},*`,"$SPAWN,,*","$AMMO,0,36,108,1,*","$AMMO,1,6,12,1,*","$BMAP,0,0,,,,,*"];
const reviveFrames = () => ["$SPAWN,,*","$AMMO,0,36,108,1,*","$AMMO,1,6,12,1,*"];

const now = () => Date.now();
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const $ = id => document.getElementById(id);

const players = {
  A: { key:'A', team:1, deviceId:null, name:'Gun A', rxBuf:'', hp:0, armor:0, ammo:0,
       alive:false, kills:0, deaths:0, lastShooterTeam:null, lastShooterAt:0, deadAt:0, lastKillAt:0, battery:null },
  B: { key:'B', team:2, deviceId:null, name:'Gun B', rxBuf:'', hp:0, armor:0, ammo:0,
       alive:false, kills:0, deaths:0, lastShooterTeam:null, lastShooterAt:0, deadAt:0, lastKillAt:0, battery:null },
};
let running=false, respawnMs=8000, fragLimit=0;

function log(msg,cls='li'){ const el=$('log'); const t=new Date().toISOString().substr(11,8);
  el.innerHTML += `<span class="${cls}">[${t}] ${msg}</span>\n`; el.scrollTop=el.scrollHeight; }

// ---- HARDENED frame reassembler: split on '*' AND on '$' boundaries -------- //
// (fixes the rare merged-notify case, e.g. "$ALCD,..$BUT,0,1,*")
function pump(p, text){
  p.rxBuf += text; const out=[];
  while(true){
    const s = p.rxBuf.indexOf('$');
    if(s<0){ p.rxBuf=''; break; }
    if(s>0) p.rxBuf = p.rxBuf.slice(s);
    const star = p.rxBuf.indexOf('*',1), nd = p.rxBuf.indexOf('$',1);
    let end;
    if(star>=0 && (nd<0 || star<nd)) end = star+1;   // complete frame ending in *
    else if(nd>=0) end = nd;                          // truncated -> next $ is the boundary
    else break;                                       // incomplete -> wait for more bytes
    const f = p.rxBuf.slice(0,end).trim(); p.rxBuf = p.rxBuf.slice(end);
    if(f) out.push(f);
  }
  return out;
}
function toks(f){ let s=f.trim(); if(s[0]==='$') s=s.slice(1);
  if(s.endsWith('*')) s=s.slice(0,-1); if(s.endsWith(',')) s=s.slice(0,-1); return s.split(','); }

// ---- BLE ------------------------------------------------------------------- //
const wq={};
function enqueue(id, fn){ wq[id]=(wq[id]||Promise.resolve()).then(fn).catch(e=>log('write err: '+(e.message||e),'le')); return wq[id]; }
async function sendFrame(id, frame){ for(let o=0;o<frame.length;o+=20){
  await BleClient.writeWithoutResponse(id, NUS, RX, textToDataView(frame.substr(o,20))); if(frame.length>20) await sleep(8);} }
async function sendMany(id, frames){ for(const f of frames){ await sendFrame(id,f); await sleep(18);} }

// Initialize EXACTLY ONCE. The iOS plugin's initialize() does
// `self.deviceManager = DeviceManager(...)` — it REPLACES the manager that owns the
// CBCentralManager and every connected peripheral, so calling it again deallocates
// the old one and drops every live gun (cap9: notifications disabled, then HCI
// disconnect reason 0x16 "Terminated By Local Host"). Calling it per-setGun meant
// connecting Gun B disconnected Gun A.
// androidNeverForLocation:true — we never derive location from the scan, so this
// (paired with the neverForLocation manifest flag from scripts/android-setup.sh)
// lets Android 12+ scan WITHOUT the system Location toggle on. Without it the scan
// returns zero devices when Location is off (empty chooser on Android, fine on iOS).
let _init = null;
function ensureInit(){ return (_init ||= BleClient.initialize({ androidNeverForLocation:true })); }

// BRX BLE establishment succeeds roughly 1 attempt in 3 — holding a link is fine,
// getting one is flaky (brx-protocol.md / HANDOFF "connecting is flaky, holding is not").
// Retrying was the ENTIRE fix on the Python side (ble.py, 5 attempts); without it here
// the user is the retry loop, tapping Set Gun until it takes.
async function connectWithRetry(key, deviceId, attempts, guard){
  let last;
  for(let i=1; i<=attempts; i++){
    if(guard && !guard()) return false;
    try{
      await BleClient.connect(deviceId, ()=>onDrop(key));
      await BleClient.startNotifications(deviceId, NUS, TX, v=>onNotify(key,v));
      return true;
    }catch(e){
      last = e;
      if(i < attempts){ log(`${key} connect ${i}/${attempts} failed — retrying…`); await sleep(1200); }
    }
  }
  throw last;
}

// ---- device picker: continuous low-latency scan + in-app list -------------- //
// requestDevice() runs a single SHORT scan, so a BRX that advertises intermittently
// (they sleep/quiet down between bursts) gets missed and the chooser is empty. A
// continuous LOW_LATENCY scan samples aggressively and accumulates devices until you
// pick — far more reliable for flaky advertisers. It also lets us label each hit with
// its MAC suffix so you can tell the guns apart before enrolling proper $NAMEs.
let _scanning = false;
const suffixOf = id => String(id||'').replace(/[^0-9a-fA-F]/g,'').slice(-4).toUpperCase();

async function pickDevice(forKey){
  if(_scanning) throw new Error('a scan is already open');
  await ensureInit();
  const modal=$('picker'), listEl=$('pickList'), statusEl=$('pickStatus');
  $('pickTitle').textContent = `Select Gun ${forKey}`;
  const found = new Map();
  const otherId = players[forKey==='A'?'B':'A'].deviceId;

  return new Promise((resolve, reject)=>{
    let done=false;
    const finish = async (val, err)=>{
      if(done) return; done=true;
      try{ await BleClient.stopLEScan(); }catch(_){}
      _scanning=false; modal.hidden=true; listEl.innerHTML=''; $('pickCancel').onclick=null;
      err ? reject(err) : resolve(val);
    };
    const paint = ()=>{
      const arr=[...found.values()].sort((a,b)=>(b.rssi??-999)-(a.rssi??-999));
      listEl.innerHTML='';
      for(const d of arr){
        const b=document.createElement('button'); b.className='pick';
        const used = d.deviceId===otherId;
        b.innerHTML = `<span><b>${d.name||'(unnamed)'}</b>${used?' <span class="used">· in use</span>':''}</span>`
          + `<span class="sfx">${suffixOf(d.deviceId)}</span><span class="rssi">${d.rssi??''}</span>`;
        if(used) b.disabled=true; else b.onclick=()=>finish(d);
        listEl.appendChild(b);
      }
      statusEl.textContent = arr.length
        ? `${arr.length} tagger(s) found — tap to connect`
        : 'scanning… power-cycle a gun if it doesn’t appear';
    };
    $('pickCancel').onclick = ()=>finish(null);
    modal.hidden=false; paint(); _scanning=true;
    // No service/name filter passed to the plugin (some adv only carry the name in the
    // scan response); we filter to BRX by name in the callback instead.
    BleClient.requestLEScan({ allowDuplicates:true, scanMode:2 }, res=>{
      const d=res.device||{}; if(!d.deviceId) return;
      const name = d.name || res.localName || '';
      if(!/^Tactix/i.test(name)) return;             // BRX taggers advertise "Tactix…"
      found.set(d.deviceId, {deviceId:d.deviceId, name, rssi:res.rssi});
      paint();
    }).catch(e=>finish(null, e));
  });
}

async function setGun(key){
  const p = players[key];
  try{
    const dev = await pickDevice(key);
    if(!dev) return;                    // cancelled
    const label = dev.name || dev.deviceId;
    log(`${key} connecting to ${label}…`);
    // Only commit deviceId AFTER the link is up: it gates updateStart(), so setting it
    // on a failed connect would enable "Start game" for a gun that isn't there.
    await connectWithRetry(key, dev.deviceId, 5);
    p.deviceId = dev.deviceId; p.name = label;
    log(`${key} = ${p.name} connected`,'lk'); renderPlayer(key); updateStart();
  }catch(e){ log(`set ${key}: ${e.message||e}`,'le'); renderPlayer(key); updateStart(); }
}

function onDrop(key){ const p=players[key]; log(`*** ${key} (${p.name}) disconnected ***`,'le');
  if(p.deviceId) reconnect(key); }

async function reconnect(key){
  const p = players[key];
  try{
    const ok = await connectWithRetry(key, p.deviceId, 6, ()=>!!players[key].deviceId);
    if(ok) log(`${key} reconnected`,'lk');
  }catch(e){ log(`${key} reconnect failed — tap Set Gun ${key}`,'le'); }
}

function onNotify(key, value){ for(const f of pump(players[key], dataViewToText(value))) handleFrame(key, f); }

function handleFrame(key, f){
  const p = players[key], t = toks(f), cmd = t[0];
  if(cmd==='HP'){ p.hp=+t[1]||0; p.armor=+t[2]||0; renderPlayer(key);
    if(p.hp===0 && p.alive && running) death(key); }
  else if(cmd==='LCD'){ p.hp=+t[1]||0; p.armor=+t[2]||0; if(t[5]!==undefined) p.ammo=+t[5]||0; renderPlayer(key); }
  else if(cmd==='ALCD'){ p.ammo=+t[1]||0; renderPlayer(key); }
  else if(cmd==='HIR'){ if(t[2]!=='15'){ const st=parseInt(t[4],10); if(!isNaN(st)){ p.lastShooterTeam=st; p.lastShooterAt=now(); } } }
  else if(cmd==='VOLTS'){ p.battery=parseInt(t[3],10); renderBatt(key); }
}

function death(key){
  const p = players[key]; p.alive=false; p.deaths++; p.deadAt=now();
  log(`☠ ${p.name} down`,'le'); renderPlayer(key);
  const kt = (now()-p.lastShooterAt <= ATTRIB_FUSE) ? p.lastShooterTeam : null;
  const killer = kt!=null ? Object.values(players).find(q=>q.deviceId && q.team===kt) : null;
  if(killer && killer.key!==key){
    killer.kills++;
    const multi = (now()-killer.lastKillAt <= MULTI_WIN); killer.lastKillAt=now();
    log(`${multi?'‼ DOUBLE KILL — ':'✚ '}${killer.name} killed ${p.name}  (${killer.kills})`,'lk');
    renderPlayer(killer.key); renderScore();
    feedback(killer.deviceId);
    if(fragLimit>0 && killer.kills>=fragLimit){ endGame(`${killer.name} WINS`); }
  } else {
    log(`  (uncredited death — no fresh enemy hit)`,'li');
  }
}
function feedback(id){ enqueue(id, async ()=>{ await sendFrame(id,'$SFLASH,*'); await sleep(120);
  await sendFrame(id, `$PLAY,,4,6,${KILL_LINE},,,,*`); }); }

// ---- game control ---------------------------------------------------------- //
async function startGame(){
  respawnMs = (+$('respawn').value||8)*1000; fragLimit = +$('frag').value||0;
  $('winner').textContent='';
  for(const p of Object.values(players)){
    if(!p.deviceId) continue;
    p.kills=0; p.deaths=0; p.alive=true; p.hp=MAX_HP; p.armor=MAX_AR; p.ammo=36; p.lastShooterTeam=null; p.deadAt=0;
    enqueue(p.deviceId, ()=>sendMany(p.deviceId, SETUP.concat(spawnFrames(p.team))));
    log(`arming ${p.name} (team ${p.team})…`);
  }
  running=true; renderAll(); renderScore();
  $('start').disabled=true; $('end').disabled=false;
  log('▶ GAME LIVE — respawn '+ (respawnMs/1000) +'s'+(fragLimit?`, frag limit ${fragLimit}`:''),'lk');
}
function endGame(reason){
  running=false; $('start').disabled=false; $('end').disabled=true;
  for(const p of Object.values(players)) if(p.deviceId) enqueue(p.deviceId, ()=>sendMany(p.deviceId, ["$SPAWN,,*","$PLAYX,0,*","$STOP,*","$CLEAR,*"]));
  if(reason) $('winner').textContent=' — '+reason;
  log('■ GAME OVER'+(reason?` — ${reason}`:''),'lk');
}
setInterval(()=>{ if(!running) return;
  for(const p of Object.values(players)){
    if(p.deviceId && !p.alive && p.deadAt && now()-p.deadAt >= respawnMs){
      p.alive=true; p.hp=MAX_HP; p.armor=MAX_AR; p.ammo=36; p.deadAt=0;
      enqueue(p.deviceId, ()=>sendMany(p.deviceId, reviveFrames()));
      log(`↻ ${p.name} respawned`); renderPlayer(p.key);
    }
  }
}, 500);

// ---- render ---------------------------------------------------------------- //
function renderPlayer(key){ const p=players[key];
  $('name'+key).textContent = p.name;
  const st=$('st'+key); st.textContent = p.deviceId ? (p.alive?'ALIVE':'DOWN') : '—';
  st.className = 'badge '+(p.alive?'alive':'dead');
  $('hp'+key).style.width = Math.max(0,Math.min(100, p.hp/MAX_HP*100))+'%';
  $('ar'+key).style.width = Math.max(0,Math.min(100, p.armor/MAX_AR*100))+'%';
  $('hpv'+key).textContent=p.hp; $('arv'+key).textContent=p.armor; $('am'+key).textContent=p.ammo;
  $('k'+key).textContent=p.kills; $('d'+key).textContent=p.deaths;
}
function renderBatt(key){ const p=players[key];
  $('batt'+key).textContent = p.battery==null ? '' : ('battery '+p.battery+'%'+(p.battery<=20?' ⚠ LOW':'')); }
function renderScore(){ $('scoreA').textContent=players.A.kills; $('scoreB').textContent=players.B.kills; }
function renderAll(){ renderPlayer('A'); renderPlayer('B'); renderBatt('A'); renderBatt('B'); }
function updateStart(){ $('start').disabled = !(players.A.deviceId && players.B.deviceId) || running; }

// ---- wiring ---------------------------------------------------------------- //
$('setA').onclick=()=>setGun('A');
$('setB').onclick=()=>setGun('B');
$('start').onclick=startGame;
$('end').onclick=()=>endGame('');
$('clearLog').onclick=()=>{ $('log').innerHTML=''; };
renderAll();
ensureInit().then(()=>{ log('BLE ready — Set Gun A then Gun B, then Start','lk'); $('status').textContent='(ready)'; })
  .catch(e=>log('init: '+(e.message||e),'le'));
