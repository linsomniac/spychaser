// Drives the running game via CDP and captures gameplay screenshots over time.
// Starts a run (Enter), then holds throttle + fires + weaves, grabbing a frame
// every `intervalMs`. Also dumps the live world state alongside each shot so we
// can judge pacing (speed, enemy count, score, sector) — not just visuals.
//
// Usage: node tools/play-capture.mjs <url> <outDir> <frames> <intervalMs>
import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";

const URL = process.argv[2] || "http://localhost:8137/index.html";
const OUT = process.argv[3] || "/tmp/sc-play";
const FRAMES = Number(process.argv[4] || 6);
const INTERVAL = Number(process.argv[5] || 1000);
const PORT = 9223;
mkdirSync(OUT, { recursive: true });

function findChrome() {
  for (const c of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    try { execSync(`command -v ${c}`, { stdio: "ignore" }); return c; } catch {}
  }
  throw new Error("no chrome");
}
const getJSON = (path) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = findChrome();
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--use-gl=swiftshader", "--window-size=540,720", `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
  try {
    let pageTarget;
    for (let i = 0; i < 50; i++) { try { const l = await getJSON("/json/list"); pageTarget = (Array.isArray(l) ? l : []).find((t) => t.type === "page" && t.webSocketDebuggerUrl); if (pageTarget) break; } catch {} await sleep(200); }
    if (!pageTarget) throw new Error("no page target");
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map(); const errs = [];
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method === "Runtime.exceptionThrown") { errs.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text); } };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJS = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r?.result?.result?.value; };
    const key = async (type, k, code, vk) => send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    const tap = async (k, code, vk) => { await key("keyDown", k, code, vk); await sleep(40); await key("keyUp", k, code, vk); };

    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: URL });
    await sleep(1400);

    // Start the run.
    await tap("Enter", "Enter", 13);
    await sleep(300);

    // Hold throttle (ArrowUp) + autofire (Space) down for the whole capture.
    await key("keyDown", "ArrowUp", "ArrowUp", 38);
    await key("keyDown", " ", "Space", 32);

    const report = [];
    let steerDir = 0;
    for (let f = 0; f < FRAMES; f++) {
      // Weave: alternate steering each frame to exercise lateral handling.
      const dirs = [["ArrowLeft", 37], ["ArrowRight", 39]];
      const [sk, svk] = dirs[steerDir % 2]; steerDir++;
      await key("keyDown", sk, sk, svk);
      await sleep(INTERVAL * 0.6);
      await key("keyUp", sk, sk, svk);
      // Occasionally deploy a special.
      if (f % 3 === 2) await tap("f", "KeyF", 70);
      await sleep(INTERVAL * 0.4);

      const state = await evalJS(`(() => { try {
        const g = window.__spychaser; const w = g && g.game && g.game.world;
        const flow = g && g.game && (g.game.stateName || (g.game.flow && g.game.flow.current) || (g.game.machine && g.game.machine.current));
        if (!w) return JSON.stringify({ flow, noWorld: true });
        const count = (a) => Array.isArray(a) ? a.length : (a && a.length) || 0;
        return JSON.stringify({
          flow,
          tick: w.tick, distance: Math.round(w.distance || 0), sector: w.sector,
          score: w.score, hi: w.hiScore, cars: (w.cars ?? w.lives),
          speed: Math.round((w.player && (w.player.speed ?? w.player.vy)) || 0),
          enemies: count(w.enemies && (w.enemies.items || w.enemies)),
          civilians: count(w.civilians && (w.civilians.items || w.civilians)),
          weapon: (w.loadedSpecial || w.weapon || (w.player && w.player.special) || 'EMPTY'),
        });
      } catch (e) { return JSON.stringify({ err: e.message }); } })()`);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = `${OUT}/frame-${String(f).padStart(2, "0")}.png`;
      if (shot?.result?.result?.data || shot?.result?.data) writeFileSync(file, Buffer.from(shot.result.data || shot.result.result.data, "base64"));
      report.push({ frame: f, file, state: state ? JSON.parse(state) : null });
    }

    await key("keyUp", "ArrowUp", "ArrowUp", 38);
    await key("keyUp", " ", "Space", 32);

    console.log(JSON.stringify({ errors: errs, frames: report }, null, 2));
    ws.close();
    process.exitCode = errs.length ? 3 : 0;
  } finally { try { process.kill(proc.pid); } catch {} }
}
main().catch((e) => { console.error("CAPTURE_ERR:", e.message); process.exitCode = 9; });
