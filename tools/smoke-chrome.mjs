import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveChromeExecutable } from "../src/bridge/companions.ts";

const chrome = resolveChromeExecutable();
if (!chrome) {
  console.log("chrome smoke: skipped — Google Chrome/Chromium not found");
  process.exit(0);
}

const extensionDir = resolve("dist/pi-webview-chrome");
const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-webview-chrome-smoke-"));
const profile = join(temporaryRoot, "profile");
const packedSource = join(temporaryRoot, "packed", "extension");
const bridgePort = 7361;
const debugPort = 9736;
let bridge;
let browser;

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitFor(action, label, attempts = 80) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise;
    socket.onerror = reject;
  });
  const value = await new Promise((resolvePromise, reject) => {
    const requestId = 1;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== requestId) return;
      if (message.error) reject(new Error(message.error.message));
      else if (message.result.exceptionDetails) {
        reject(
          new Error(
            message.result.exceptionDetails.exception?.description ??
              message.result.exceptionDetails.text,
          ),
        );
      } else resolvePromise(message.result.result.value);
    };
    socket.send(
      JSON.stringify({
        id: requestId,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }),
    );
  });
  socket.close();
  return value;
}

try {
  cpSync(extensionDir, packedSource, { recursive: true });
  const pack = spawnSync(chrome, ["--no-sandbox", `--pack-extension=${packedSource}`], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (pack.error || pack.status !== 0) {
    throw new Error(pack.stderr || pack.error?.message || "Chrome rejected the package");
  }

  bridge = spawn(
    process.execPath,
    [
      "src/bridge/index.ts",
      "--serve",
      "dist/web",
      "--port",
      String(bridgePort),
      "--no-idle",
    ],
    { stdio: "ignore" },
  );
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${bridgePort}/bridge-config.json`);
    return response.ok;
  }, "piw bridge");

  browser = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--no-first-run",
      "--disable-default-apps",
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `--remote-debugging-port=${debugPort}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    return response.ok ? response.json() : null;
  }, "Chrome remote debugging");
  const extensionTarget = targets.find((item) =>
    item.url?.endsWith("/service-worker.js"),
  );
  if (!extensionTarget) {
    console.log(
      "chrome smoke: package accepted; runtime skipped because this Chrome build blocks command-line extension loading",
    );
  } else {
    const extensionId = new URL(extensionTarget.url).host;
    const panelUrl = `chrome-extension://${extensionId}/index.html`;
    const created = await fetch(
      `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(panelUrl)}`,
      { method: "PUT" },
    );
    if (!created.ok) {
      throw new Error(`Chrome target creation failed: ${created.status}`);
    }

    const panel = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const items = await response.json();
      return items.find((item) => item.type === "page" && item.url === panelUrl) ?? null;
    }, "Chrome side-panel page");

    const state = await waitFor(async () => {
      const value = await evaluate(
        panel.webSocketDebuggerUrl,
        `JSON.stringify({runtime:document.documentElement?.dataset.runtime,status:document.getElementById("conn-dot")?.className,connectHidden:document.getElementById("connect-panel")?.hidden})`,
      );
      if (typeof value !== "string") return null;
      const candidate = JSON.parse(value);
      return candidate.status === "conn-dot conn-open" ? candidate : null;
    }, "Chrome side-panel bridge connection");

    if (state.runtime !== "browser-extension" || state.connectHidden !== true) {
      throw new Error(`Unexpected Chrome panel state: ${JSON.stringify(state)}`);
    }
    console.log("chrome smoke: extension loaded and Side Panel UI connected to piw");
  }
} finally {
  browser?.kill();
  bridge?.kill();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
