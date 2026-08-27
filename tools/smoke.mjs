// `pnpm smoke` — bridge smoke test without an LLM (plan 0001 step 3):
// starts the bridge, connects via WebSocket and verifies the RPC protocol
// with commands that do not need the model (get_state, get_commands).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = fileURLToPath(new URL("..", import.meta.url));
const TIMEOUT_MS = 30_000;

const bridge = spawn("node", ["src/bridge/index.ts"], { cwd: root });
bridge.stderr.on("data", (buf) => process.stderr.write(`[bridge] ${buf}`));

const timeout = setTimeout(() => {
  console.error("smoke: timeout");
  bridge.kill();
  process.exit(1);
}, TIMEOUT_MS);

function waitForReady() {
  return new Promise((resolve, reject) => {
    const onData = (buf) => {
      const text = buf.toString();
      const m = text.match(/BRIDGE_READY (\S+)/);
      if (m) {
        bridge.stdout.off("data", onData);
        resolve(m[1]);
      }
    };
    bridge.stdout.on("data", onData);
    bridge.on("exit", (code) => reject(new Error(`bridge uscito con code=${code}`)));
  });
}

function rpc(ws, command, id) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.channel !== "rpc") return;
      const msg = frame.payload;
      if (
        msg.type === "response" &&
        msg.command === command.type &&
        (!id || msg.id === id)
      ) {
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
    ws.send(
      JSON.stringify({ channel: "rpc", payload: { ...command, ...(id ? { id } : {}) } }),
    );
    setTimeout(() => reject(new Error(`nessuna risposta a ${command.type}`)), 10_000);
  });
}

try {
  const wsUrl = await waitForReady();
  console.log(`smoke: bridge pronto → ${wsUrl}`);

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  console.log("smoke: connesso");

  const state = await rpc(ws, { type: "get_state" });
  if (!state.success) throw new Error("get_state fallito");
  console.log(`smoke: get_state ok → model=${state.data?.model?.id ?? "nessuno"}`);

  const cmds = await rpc(ws, { type: "get_commands" });
  if (!cmds.success) throw new Error("get_commands fallito");
  console.log(`smoke: get_commands ok → ${cmds.data?.commands?.length ?? 0} comandi`);

  const msgs = await rpc(ws, { type: "get_messages" });
  if (!msgs.success) throw new Error("get_messages fallito");
  console.log(`smoke: get_messages ok → ${msgs.data?.messages?.length ?? 0} messaggi`);

  ws.close();
  clearTimeout(timeout);
  console.log("smoke: OK");
  bridge.kill();
  process.exit(0);
} catch (err) {
  clearTimeout(timeout);
  console.error(`smoke: FAIL → ${err.message}`);
  bridge.kill();
  process.exit(1);
}
