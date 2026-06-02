// One-shot: start a run, drive ~18s, then dump the real shape of the world's
// entity collections + a pacing timeline, so we know how to read enemy/civilian
// counts and whether spawning works past the first milestones.
import { spawn, execSync } from "node:child_process";
import http from "node:http";
const URL = process.argv[2] || "http://localhost:8137/index.html";
const PORT = 9224;
const findChrome = () => { for (const c of ["google-chrome-stable","google-chrome","chromium","chromium-browser"]) { try { execSync(`command -v ${c}`,{stdio:"ignore"}); return c; } catch {} } throw new Error("no chrome"); };
const getJSON = (p) => new Promise((res,rej)=>{ http.get({host:"127.0.0.1",port:PORT,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on("error",rej); });
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const proc = spawn(findChrome(),["--headless=new","--disable-gpu","--no-sandbox","--no-first-run","--use-gl=swiftshader","--window-size=540,720",`--remote-debugging-port=${PORT}`,"about:blank"],{stdio:"ignore"});
  try{
    let pt; for(let i=0;i<50;i++){try{const l=await getJSON("/json/list");pt=(Array.isArray(l)?l:[]).find(t=>t.type==="page"&&t.webSocketDebuggerUrl);if(pt)break}catch{}await sleep(200);}
    const ws=new WebSocket(pt.webSocketDebuggerUrl); await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
    let id=0;const pend=new Map();ws.onmessage=m=>{const x=JSON.parse(m.data);if(x.id&&pend.has(x.id)){pend.get(x.id)(x);pend.delete(x.id);}};
    const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
    const ev=async(e)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true});return r?.result?.result?.value;};
    const key=(type,k,code,vk)=>send("Input.dispatchKeyEvent",{type,key:k,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
    await send("Runtime.enable");await send("Page.enable");await send("Page.navigate",{url:URL});await sleep(1400);
    await key("keyDown","Enter","Enter",13);await sleep(40);await key("keyUp","Enter","Enter",13);await sleep(200);
    await key("keyDown","ArrowUp","ArrowUp",38); // full throttle the whole time

    // Shape dump after a couple seconds.
    await sleep(2500);
    const shape = await ev(`(() => { const w = window.__spychaser.game.world; const keys = Object.keys(w);
      const desc = {}; for (const k of keys) { const v = w[k]; desc[k] = Array.isArray(v) ? ('array['+v.length+']') : (v && typeof v==='object') ? ('obj{'+Object.keys(v).slice(0,8).join(',')+'}') : typeof v; }
      return JSON.stringify(desc); })()`);
    console.log("WORLD_KEYS=" + shape);

    // Pacing timeline over ~16s.
    const tl=[];
    for(let i=0;i<8;i++){
      await sleep(2000);
      const row = await ev(`(() => { const g=window.__spychaser.game; const w=g.world;
        const arr=(x)=> Array.isArray(x)?x : (x&&x.items)?x.items : (x&&x.active)?x.active : [];
        const live=(x)=>{ const a=arr(x); return a.filter(e=>!e||e.alive===undefined?true:e.alive).length; };
        return JSON.stringify({ d:Math.round(w.distance||0), sec:w.sector, score:w.score, cars:(w.cars??w.lives),
          enemies: live(w.enemies), civ: live(w.civilians),
          bombs: live(w.bombs), heli: !!w.helicopter || !!(g.helicopter), weather: (w.weather&&(w.weather.kind||w.weather.current))||(w.weatherKind)||'none',
          van: !!w.weaponsVan || !!w.van, onWater: !!w.onWater || !!(w.player&&w.player.isBoat) }); })()`);
      tl.push(JSON.parse(row));
    }
    await key("keyUp","ArrowUp","ArrowUp",38);
    console.log("TIMELINE=" + JSON.stringify(tl,null,2));
    ws.close();
  } finally { try{process.kill(proc.pid)}catch{} }
}
main().catch(e=>{console.error("ERR:",e.message);process.exitCode=9;});
