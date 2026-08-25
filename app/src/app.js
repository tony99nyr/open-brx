// BRX Companion — native BLE test (Capacitor). Same UI/gates as ble-test.html,
// but BLE goes through the NATIVE plugin (Android BLE / iOS CoreBluetooth) — no
// Web Bluetooth, no flags. One codebase → Android APK + iOS app.
import { BleClient, textToDataView, dataViewToText } from '@capacitor-community/bluetooth-le';

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // phone -> gun
const TX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // gun -> phone (notify)

const ARM_FRAMES = [
  "$VOL,69,0,*","$CLEAR,*","$START,*",
  "$GSET,1,0,1,0,1,0,50,1,*",
  "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*",
  "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*",
  "$WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*",
  "$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*",
  "$SIR,0,0,,1,0,0,1,,*","$SIR,0,1,,36,0,0,1,,*","$SIR,0,3,,37,0,0,1,,*","$SIR,8,0,,38,0,0,1,,*",
  "$SIR,9,3,,24,10,0,,,*","$SIR,10,0,X13,1,0,100,2,60,*","$SIR,6,0,H02,1,0,90,1,40,*",
  "$SIR,13,1,H57,1,0,0,1,,*","$SIR,13,0,H50,1,0,0,1,,*","$SIR,13,3,H49,1,0,100,0,60,*",
  "$BMAP,0,0,,,,,*","$BMAP,1,100,0,1,99,99,*","$BMAP,2,97,,,,,*","$BMAP,3,98,,,,,*",
  "$BMAP,4,98,,,,,*","$BMAP,5,98,,,,,*","$BMAP,8,4,,,,,*",
  "$PLAYX,0,*","$PLAY,VA81,4,6,,,,,*",
  "$TID,1,*","$SPAWN,,*","$AMMO,0,36,108,1,*","$AMMO,1,6,12,1,*","$BMAP,0,0,,,,,*"
];

const GATES = [
  ['G1','Connect','native requestDevice → connect'],
  ['G2','Notify','pull trigger / take a hit → frames stream'],
  ['G3','Write','$VOL + $PLAY → the gun speaks'],
  ['G4','Feedback','$SFLASH → the sight goes GREEN'],
  ['G5','Arm','config burst → gun counts down / goes live'],
  ['G6','Stability','hold ~3 min; survive the ~6.6 s drop'],
];
const gstate = {};
const $ = id => document.getElementById(id);

function renderGates(){
  const el = $('gates'); el.innerHTML = '';
  for(const [g,name,desc] of GATES){
    const d = document.createElement('div'); d.className='gate';
    d.innerHTML = `<span class="dot ${gstate[g]||''}"></span><span class="g">${g}</span>
      <span class="t">${name}<small>${desc}</small></span>`;
    if(['G2','G3','G4','G5'].includes(g)){
      const p=document.createElement('button'); p.textContent='✓'; p.onclick=()=>setGate(g,'pass');
      const f=document.createElement('button'); f.textContent='✗'; f.className='danger'; f.onclick=()=>setGate(g,'fail');
      d.append(p,f);
    }
    el.append(d);
  }
}
function setGate(g,s){ gstate[g]=s; renderGates(); }

let deviceId=null, rxBuf='', rxCount=0, txCount=0, reconnects=0, connectedAt=0, wantConnected=false;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function log(msg,cls='li'){ const el=$('log'); const t=new Date().toISOString().substr(11,12);
  el.innerHTML += `<span class="${cls}">[${t}] ${msg}</span>\n`; el.scrollTop=el.scrollHeight; }
function setStatus(on){ const s=$('status'); s.textContent=on?'connected':'disconnected'; s.className='pill '+(on?'on':'off'); }
function setControls(on){ for(const id of ['speak','flash','panic','send','armBtn']) $(id).disabled=!on;
  $('disconnect').disabled=!on; $('connect').disabled=on; $('scan').disabled=on; }

async function ensureInit(){ await BleClient.initialize({ androidNeverForLocation:false }); }

async function connect(filterByName){
  try{
    await ensureInit();
    const opts = filterByName ? { namePrefix:'Tactix', optionalServices:[NUS] }
                              : { optionalServices:[NUS] };
    const dev = await BleClient.requestDevice(opts);
    deviceId = dev.deviceId; wantConnected = true;
    await openLink();
    log('connected '+(dev.name||deviceId));
  }catch(e){ log('connect: '+(e.message||e),'le'); setGate('G1','fail'); }
}
async function openLink(){
  await BleClient.connect(deviceId, onDisconnect);
  await BleClient.startNotifications(deviceId, NUS, TX, onNotify);
  connectedAt = Date.now(); setStatus(true); setControls(true); setGate('G1','pass');
}
function onNotify(value){
  rxBuf += dataViewToText(value);
  let i;
  while((i = rxBuf.indexOf('*')) >= 0){
    const f = rxBuf.slice(0, i+1).trim(); rxBuf = rxBuf.slice(i+1);
    if(f){ rxCount++; $('rxc').textContent=rxCount; if(gstate.G2!=='pass') setGate('G2','pass'); log('>> '+f,'lr'); }
  }
}
function onDisconnect(){
  setStatus(false); setControls(false); connectedAt=0; log('*** disconnected ***','le');
  if(wantConnected){ reconnects++; $('rec').textContent=reconnects; retry(); }
}
async function retry(){
  for(let i=1;i<=8 && wantConnected;i++){
    log('reconnect attempt '+i+'…');
    try{ await openLink(); log('reconnected'); return; } catch(e){ await sleep(1000); }
  }
  if(wantConnected) log('reconnect gave up after 8 tries','le');
}
async function disconnect(){ wantConnected=false; try{ await BleClient.disconnect(deviceId); }catch(e){}
  setStatus(false); setControls(false); }

async function sendFrame(frame){
  if(!deviceId){ log('not connected','le'); return false; }
  for(let o=0;o<frame.length;o+=20){
    const dv = textToDataView(frame.substr(o,20));
    try{ await BleClient.writeWithoutResponse(deviceId, NUS, RX, dv); }
    catch(e){ log('write failed: '+(e.message||e),'le'); return false; }
    if(frame.length>20) await sleep(8);
  }
  txCount++; $('txc').textContent=txCount; log('<< '+frame,'lt'); return true;
}
async function sendMany(frames){ for(const f of frames){ if(!(await sendFrame(f))) break; await sleep(20); } }

// wiring
$('connect').onclick = ()=>connect(true);
$('scan').onclick    = ()=>connect(false);
$('disconnect').onclick = disconnect;
$('speak').onclick = async ()=>{ await sendFrame('$VOL,69,0,*'); await sleep(150); await sendFrame('$PLAY,VA20,4,6,,,,,*'); };
$('flash').onclick = ()=> sendFrame('$SFLASH,*');
$('panic').onclick = async ()=>{ await sendFrame('$CLEAR,*'); await sleep(100); await sendFrame('$SP,99,*'); };
$('send').onclick  = ()=>{ const v=$('frame').value.trim(); if(v) sendFrame(v); };
$('armBtn').onclick= ()=> sendMany($('arm').value.split('\n').map(s=>s.trim()).filter(Boolean));
$('clearLog').onclick=()=>{ $('log').innerHTML=''; };

$('arm').value = ARM_FRAMES.join('\n');
$('hint').textContent = 'Native BLE — tap Connect. Grant Bluetooth/Location if prompted.';
renderGates();
ensureInit().then(()=>log('BLE ready')).catch(e=>log('init: '+(e.message||e),'le'));
setInterval(()=>{ if(connectedAt){ const s=Math.floor((Date.now()-connectedAt)/1000);
  $('upt').textContent = s<60? s+'s' : Math.floor(s/60)+'m'+(s%60)+'s'; } else $('upt').textContent='0s'; }, 1000);
