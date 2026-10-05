// F464 fairness sweep: how much capture time the 0.5 s-delayed decay costs a phone truly INSIDE the circle, by advert
// gap and advert loss (200 seeds each; decay on vs off). It prints a table and asserts nothing. The numbers in
// docs/spec/utility.md section 5d.0 come from it: `cd app && node tools/hill-fairness-sweep.mjs`.
import { Presence, PLAYER_STATE, encodeUuid } from '../src/beacon.js';
import { ControlPoint } from '../src/control.js';
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function gauss(r){return Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r());}
function run(period, mean, sigma, loss, decayS, seed){
  const r=rng(seed); const pres=new Presence({defaultThreshold:-75,dwellMs:800,hysteresisDb:3,exitGraceMs:4000,expiryMs:4000,sightMs:4000,alpha:0.35});
  const cp=new ControlPoint({decayS}); const adv=encodeUuid({role:'player',id:1,team:0,state:PLAYER_STATE.alive});
  let nextAdv=Math.floor(r()*period); let uncounted=0;
  for(let t=0;t<120000;t+=250){
    while(nextAdv<=t){ if(r()>=loss) pres.observe([adv], mean+sigma*gauss(r), nextAdv); nextAdv+=period; }
    pres.tick(t); cp.update(pres.players(),t);
    if(cp.lead==null) uncounted+=250;
    if(cp.owner===0) return {t,uncounted};
  }
  return {t:Infinity,uncounted};
}
const rows=[];
for (const [mean,sigma,loss] of [[-72,4,0],[-72,4,0.2],[-70,4,0.2],[-74,4,0]]) for(const period of [250,1000,1400,1800,2500]){
  let a=[],b=[],u=[];
  for(let s=1;s<=200;s++){ const x=run(period,mean,sigma,loss,10,s), y=run(period,mean,sigma,loss,1e12,s); a.push(x.t); b.push(y.t); u.push(x.uncounted);}
  const med=v=>{const w=[...v].sort((p,q)=>p-q);return w[100];}; const mean_=v=>v.filter(isFinite).reduce((p,q)=>p+q,0)/v.filter(isFinite).length;
  console.log(`mean ${mean} sd ${sigma} loss ${loss} period ${period}: decay med ${med(a)} mean ${mean_(a).toFixed(0)} | nodecay med ${med(b)} mean ${mean_(b).toFixed(0)} | fail ${a.filter(x=>!isFinite(x)).length}/${b.filter(x=>!isFinite(x)).length} uncounted_ms ${mean_(u).toFixed(0)}`);
}
