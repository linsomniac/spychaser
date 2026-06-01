// Headless-Chrome boot smoke test via the DevTools Protocol over a raw WebSocket.
// No npm deps: drives Chrome --headless --remote-debugging-port directly.
// Loads the game page, collects console + page errors, runs a few sim frames by
// advancing time, and writes a screenshot. Exits non-zero on any page error.
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import http from "node:http";

const URL = process.argv[2] || "http://localhost:8137/index.html";
const SHOT = process.argv[3] || "/tmp/spychaser-shot.png";
const PORT = 9222;

function findChrome() {
  for (const c of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    try { execSync(`command -v ${c}`, { stdio: "ignore" }); return c; } catch {}
  }
  throw new Error("no chrome found");
}

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path }, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = findChrome();
  const proc = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    "--use-gl=swiftshader", "--window-size=540,720",
    `--remote-debugging-port=${PORT}`, "about:blank",
  ], { stdio: "ignore", detached: false });

  try {
    // wait for devtools endpoint, then pick a PAGE target (not the browser endpoint).
    let pageTarget;
    for (let i = 0; i < 50; i++) {
      try {
        const list = await getJSON("/json/list");
        pageTarget = (Array.isArray(list) ? list : []).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (pageTarget) break;
      } catch {}
      await sleep(200);
    }
    if (!pageTarget) throw new Error("no page target with a websocket url");
    const wsUrl = pageTarget.webSocketDebuggerUrl;

    // Minimal CDP client over ws via the built-in WebSocket (Node >=22 has global WebSocket).
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) events.push(msg);
    };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

    const consoleErrors = [];
    const pageErrors = [];

    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("Runtime.evaluate", { expression: "1+1" });

    // hook listeners
    const drain = () => {
      for (const e of events.splice(0)) {
        if (e.method === "Runtime.exceptionThrown") {
          const d = e.params.exceptionDetails;
          pageErrors.push(d.exception?.description || d.text || JSON.stringify(d));
        } else if (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") {
          consoleErrors.push((e.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
        } else if (e.method === "Log.entryAdded" && e.params.entry.level === "error") {
          consoleErrors.push(e.params.entry.text);
        }
      }
    };

    await send("Page.navigate", { url: URL });
    await sleep(1500);
    drain();

    // Is the engine alive? Poll the debug handle the game exposes on window.
    const probe = await send("Runtime.evaluate", {
      expression: `(() => {
        const g = window.__spychaser;
        if (!g) return JSON.stringify({ booted: false });
        return JSON.stringify({
          booted: true,
          hasGame: !!g.game,
          loopRunning: !!(g.loop && g.loop.running !== false),
          state: g.game && g.game.state && (g.game.state.current || (g.game.state.machine && g.game.state.machine.current)) || (g.game && g.game.stateName) || 'unknown',
          tick: g.game && (g.game.world ? g.game.world.tick : g.game.tick),
          ctxType: (document.getElementById('game') && document.getElementById('game').getContext) ? 'canvas-ok' : 'no-canvas',
        });
      })()`,
      returnByValue: true,
    });

    // Simulate a keypress (Enter to start) and let it run a moment.
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }).catch(() => {});
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }).catch(() => {});
    await sleep(800);
    drain();

    const probe2 = await send("Runtime.evaluate", {
      expression: `(() => { const g = window.__spychaser; return JSON.stringify({ tick: g && g.game && (g.game.world ? g.game.world.tick : g.game.tick) }); })()`,
      returnByValue: true,
    });

    // Screenshot
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (shot.result && shot.result.data) writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));

    const val = (p) => (p && p.result && p.result.result && "value" in p.result.result) ? p.result.result.value
      : (p && p.result && "value" in p.result) ? p.result.value
      : JSON.stringify(p && p.result);
    console.log("PROBE1=" + val(probe));
    console.log("PROBE2=" + val(probe2));
    console.log("CONSOLE_ERRORS=" + JSON.stringify(consoleErrors));
    console.log("PAGE_ERRORS=" + JSON.stringify(pageErrors));
    console.log("SHOT=" + SHOT);

    ws.close();
    const ok = pageErrors.length === 0;
    process.exitCode = ok ? 0 : 3;
  } finally {
    try { process.kill(proc.pid); } catch {}
  }
}
main().catch((e) => { console.error("SMOKE_HARNESS_ERROR:", e.message); process.exitCode = 9; });
