// BRX Companion — single-gun HUD node (ADR-0002). One phone drives ONE gun over
// BLE: arms it, tracks health/damage/ammo from $HP/$LCD/$ALCD, detects the player's
// own death (+ who shot them, from $HIR shooter team), and respawns locally. Runs
// fully autonomously — no server needed for your own gun's loop. Cross-player KILL
// scoring + kill feedback ($SFLASH green sight) come from Mission Control over the
// field LAN (the gun is host-blind about its own kills, ADR-0001), wired later.
import { BleClient, textToDataView, dataViewToText } from '@capacitor-community/bluetooth-le';

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const KILL_LINE = 'V3A';           // "kill" (confirmed, sound-bank) — for MC-driven feedback
const MAX_HP = 45, MAX_AR = 70, START_AMMO = 36;
const TEAM_NAME = { 1:'BLUE', 2:'YELLOW' }, TEAM_CLASS = { 1:'blue', 2:'yellow' };

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

const me = {
  team:1, deviceId:null, name:'— no gun —', rxBuf:'',
  hp:0, armor:0, ammo:0, alive:false, deaths:0, kills:0,
  lastShooterTeam:null, lastShooterAt:0, deadAt:0, battery:null,
};
let running=false, respawnMs=8000;

function log(msg,cls='li'){ const el=$('log'); const t=new Date().toISOString().substr(11,8);
  el.innerHTML += `<span class="${cls}">[${t}] ${msg}</span>\n`; el.scrollTop=el.scrollHeight; }

// ---- HARDENED frame reassembler: split on '*' AND on '$' boundaries -------- //
// (fixes the rare merged-notify case, e.g. "$ALCD,..$BUT,0,1,*")
function pump(text){
  me.rxBuf += text; const out=[];
  while(true){
    const s = me.rxBuf.indexOf('$');
    if(s<0){ me.rxBuf=''; break; }
    if(s>0) me.rxBuf = me.rxBuf.slice(s);
    const star = me.rxBuf.indexOf('*',1), nd = me.rxBuf.indexOf('$',1);
    let end;
    if(star>=0 && (nd<0 || star<nd)) end = star+1;   // complete frame ending in *
    else if(nd>=0) end = nd;                          // truncated -> next $ is the boundary
    else break;                                       // incomplete -> wait for more bytes
    const f = me.rxBuf.slice(0,end).trim(); me.rxBuf = me.rxBuf.slice(end);
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

// Initialize EXACTLY ONCE. The iOS plugin's initialize() REPLACES the manager that
// owns the CBCentralManager + every connected peripheral, so a second call drops the
// live gun (cap9). androidNeverForLocation:true — we never derive location, so this
// (with the neverForLocation manifest flag from scripts/android-setup.sh) lets
// Android 12+ scan WITHOUT the system Location toggle on.
let _init = null;
function ensureInit(){ return (_init ||= BleClient.initialize({ androidNeverForLocation:true })); }

// BRX establishment succeeds ~1 attempt in 3 (holding a link is fine, getting one is
// flaky). Retrying was the entire fix on the Python side; without it the user is the loop.
async function connectWithRetry(id, attempts, guard){
  let last;
  for(let i=1;i<=attempts;i++){
    if(guard && !guard()) return false;
    try{
      await BleClient.connect(id, ()=>onDrop());
      await BleClient.startNotifications(id, NUS, TX, v=>onNotify(v));
      return true;
    }catch(e){ last=e; if(i<attempts){ log(`connect ${i}/${attempts} failed — retrying…`); await sleep(1200); } }
  }
  throw last;
}

// ---- device picker: continuous low-latency scan + in-app list -------------- //
// requestDevice() runs a single SHORT scan, so an intermittently-advertising BRX gets
// missed (empty chooser). A continuous LOW_LATENCY scan accumulates devices until you
// pick — far more reliable. Labels each hit with its MAC suffix + signal.
let _scanning = false;
const suffixOf = id => String(id||'').replace(/[^0-9a-fA-F]/g,'').slice(-4).toUpperCase();

async function pickDevice(){
  if(_scanning) throw new Error('a scan is already open');
  await ensureInit();
  const modal=$('picker'), listEl=$('pickList'), statusEl=$('pickStatus');
  const found = new Map();
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
        b.innerHTML = `<span><b>${d.name||'(unnamed)'}</b></span>`
          + `<span class="sfx">${suffixOf(d.deviceId)}</span><span class="rssi">${d.rssi??''}</span>`;
        b.onclick=()=>finish(d);
        listEl.appendChild(b);
      }
      statusEl.textContent = arr.length ? `${arr.length} tagger(s) found — tap to connect`
        : 'scanning… power-cycle a gun if it doesn’t appear';
    };
    $('pickCancel').onclick = ()=>finish(null);
    modal.hidden=false; paint(); _scanning=true;
    BleClient.requestLEScan({ allowDuplicates:true, scanMode:2 }, res=>{
      const d=res.device||{}; if(!d.deviceId) return;
      const name = d.name || res.localName || '';
      if(!name) return;                      // drop unnamed BLE noise; enrolled guns advertise their name
      found.set(d.deviceId, {deviceId:d.deviceId, name, rssi:res.rssi});
      paint();
    }).catch(e=>finish(null, e));
  });
}

async function setGun(){
  try{
    const dev = await pickDevice();
    if(!dev) return;                    // cancelled
    const label = dev.name || dev.deviceId;
    log(`connecting to ${label}…`);
    await connectWithRetry(dev.deviceId, 5);
    me.deviceId = dev.deviceId; me.name = label;
    log(`${me.name} connected`,'lk'); render(); updateStart();
  }catch(e){ log(`set gun: ${e.message||e}`,'le'); render(); updateStart(); }
}
function onDrop(){ log(`*** ${me.name} disconnected ***`,'le'); if(me.deviceId) reconnect(); }
async function reconnect(){
  try{ const ok = await connectWithRetry(me.deviceId, 6, ()=>!!me.deviceId);
    if(ok) log('reconnected','lk'); }
  catch(e){ log('reconnect failed — tap Set my gun','le'); }
}

function onNotify(value){ for(const f of pump(dataViewToText(value))) handleFrame(f); }

function handleFrame(f){
  const t = toks(f), cmd = t[0];
  if(cmd==='HP'){ me.hp=+t[1]||0; me.armor=+t[2]||0; render();
    if(me.hp===0 && me.alive && running) death(); }
  else if(cmd==='LCD'){ me.hp=+t[1]||0; me.armor=+t[2]||0; if(t[5]!==undefined) me.ammo=+t[5]||0; render(); }
  else if(cmd==='ALCD'){ me.ammo=+t[1]||0; render(); }
  else if(cmd==='HIR'){ if(t[2]!=='15'){ const st=parseInt(t[4],10); if(!isNaN(st)){ me.lastShooterTeam=st; me.lastShooterAt=now(); } } }
  else if(cmd==='VOLTS'){ me.battery=parseInt(t[3],10); renderBatt(); }
}

function death(){
  me.alive=false; me.deaths++; me.deadAt=now();
  const by = me.lastShooterTeam!=null ? (TEAM_NAME[me.lastShooterTeam]||`team ${me.lastShooterTeam}`) : '?';
  log(`☠ you were killed by ${by} — respawn in ${respawnMs/1000}s`,'le');
  $('killedby').textContent = `☠ killed by ${by}`;
  render();
  // NOTE: your kill of an enemy is scored by Mission Control (the gun doesn't report
  // its own kills over BLE) — feedback() below is what MC will call to green your sight.
}
// Called by Mission Control when you score a kill (wired with the LAN layer). Drives
// the native feel over stock BLE: green sight ($SFLASH) + "kill" voice line.
function feedback(){ if(!me.deviceId) return; enqueue(me.deviceId, async ()=>{
  await sendFrame(me.deviceId,'$SFLASH,*'); await sleep(120);
  await sendFrame(me.deviceId, `$PLAY,,4,6,${KILL_LINE},,,,*`); }); }

// ---- game control ---------------------------------------------------------- //
async function startGame(){
  if(!me.deviceId) return;
  respawnMs = (+$('respawn').value||8)*1000;
  me.deaths=0; me.kills=0; me.alive=true; me.hp=MAX_HP; me.armor=MAX_AR; me.ammo=START_AMMO;
  me.lastShooterTeam=null; me.deadAt=0; $('killedby').textContent='';
  enqueue(me.deviceId, ()=>sendMany(me.deviceId, SETUP.concat(spawnFrames(me.team))));
  log(`arming ${me.name} (team ${TEAM_NAME[me.team]})…`);
  running=true; render();
  $('start').disabled=true; $('end').disabled=false; $('setGun').disabled=true; teamButtons(true);
  log(`▶ LIVE — respawn ${respawnMs/1000}s`,'lk');
}
function endGame(){
  running=false; $('start').disabled=false; $('end').disabled=true; $('setGun').disabled=false; teamButtons(false);
  if(me.deviceId) enqueue(me.deviceId, ()=>sendMany(me.deviceId, ["$SPAWN,,*","$PLAYX,0,*","$STOP,*","$CLEAR,*"]));
  me.alive=false; $('killedby').textContent=''; render();
  log('■ game ended','lk');
}
setInterval(()=>{ if(!running) return;
  if(me.deviceId && !me.alive && me.deadAt && now()-me.deadAt >= respawnMs){
    me.alive=true; me.hp=MAX_HP; me.armor=MAX_AR; me.ammo=START_AMMO; me.deadAt=0;
    $('killedby').textContent='';
    enqueue(me.deviceId, ()=>sendMany(me.deviceId, reviveFrames()));
    log('↻ respawned'); render();
  }
}, 500);

// ---- render ---------------------------------------------------------------- //
function render(){
  $('gunName').textContent = me.name;
  const st=$('state');
  st.textContent = !me.deviceId ? 'IDLE' : (!running ? 'READY' : (me.alive?'ALIVE':'DOWN'));
  st.className = 'badge '+(!me.deviceId||!running ? 'idle' : (me.alive?'alive':'dead'));
  $('hud').className = 'hud '+TEAM_CLASS[me.team];
  $('hp').style.width = Math.max(0,Math.min(100, me.hp/MAX_HP*100))+'%';
  $('ar').style.width = Math.max(0,Math.min(100, me.armor/MAX_AR*100))+'%';
  $('hpv').textContent=me.hp; $('arv').textContent=me.armor;
  $('ammo').textContent=me.ammo; $('deaths').textContent=me.deaths;
}
function renderBatt(){ $('batt').textContent = me.battery==null ? '' : ('battery '+me.battery+'%'+(me.battery<=20?' ⚠ LOW':'')); }
function updateStart(){ $('start').disabled = !me.deviceId || running; }
function teamButtons(lock){ for(const b of $('teamSeg').children) b.disabled = lock; }

// ---- wiring ---------------------------------------------------------------- //
$('setGun').onclick=setGun;
$('start').onclick=startGame;
$('end').onclick=endGame;
$('clearLog').onclick=()=>{ $('log').innerHTML=''; };
for(const b of $('teamSeg').children){
  b.onclick=()=>{ if(running) return; me.team=+b.dataset.team;
    for(const x of $('teamSeg').children) x.classList.toggle('on', x===b);
    render(); };
}
render();
ensureInit().then(()=>{ log('BLE ready — Set my gun, pick your team, then Start','lk'); $('status').textContent='(ready)'; })
  .catch(e=>log('init: '+(e.message||e),'le'));
