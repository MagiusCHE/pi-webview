// `pnpm dev` — avvia bridge (--debug) + vite (HMR) e apre il browser.
// Legge l'URL del bridge dall'output del bridge e lo passa a vite via env.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { openBrowser } from "./open-browser.mjs";

const root = new URL("..", import.meta.url).pathname;
const bin = (name) => {
  const base = `${root}node_modules/.bin/${name}`;
  if (existsSync(base)) return base;
  if (existsSync(base + ".cmd")) return base + ".cmd";
  if (existsSync(base + ".exe")) return base + ".exe";
  throw new Error(`binario non trovato: ${name}`);
};

const children = [];
const killAll = (code = 0) => {
  for (const c of children) c.kill();
  process.exit(code);
};
process.on("SIGINT", () => killAll(0));
process.on("SIGTERM", () => killAll(0));

const prefix = (label) => (buf) => {
  for (const line of buf.toString().split("\n")) {
    if (line.trim()) console.log(`[${label}] ${line}`);
  }
};

// 1) bridge
const bridge = spawn("node", ["src/bridge/index.ts", "--debug"], { cwd: root });
children.push(bridge);
bridge.stdout.on("data", (buf) => {
  const text = buf.toString();
  prefix("bridge")(buf);
  const m = text.match(/BRIDGE_READY (\S+)/);
  if (m && !startedVite) void startVite(m[1]);
});
bridge.stderr.on("data", prefix("bridge:err"));
bridge.on("exit", (code) => {
  console.error(`bridge terminato (code=${code})`);
  killAll(code ?? 1);
});

// 2) vite (dopo che il bridge è pronto)
let startedVite = false;
async function startVite(wsUrl) {
  startedVite = true;
  const vite = spawn(bin("vite"), [], {
    cwd: root,
    env: { ...process.env, VITE_BRIDGE_URL: wsUrl },
  });
  children.push(vite);
  vite.stdout.on("data", (buf) => {
    const text = buf.toString();
    prefix("web")(buf);
    const m = text.match(/http:\/\/localhost:\d+/);
    if (m && !opened) {
      opened = true;
      console.log(`\n  → apertura browser: ${m[0]}\n`);
      openBrowser(m[0]);
    }
  });
  vite.stderr.on("data", prefix("web:err"));
  vite.on("exit", (code) => {
    console.error(`vite terminato (code=${code})`);
    killAll(code ?? 1);
  });
}

let opened = false;
