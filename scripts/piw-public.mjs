#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isIPv4 } from "node:net";
import qrcode from "qrcode-terminal";
import { createInterface } from "node:readline/promises";

const RESTART_TOKEN_ENV = "PIW_RESTART_TOKEN";
const DETACHED_ENV = "PIW_DETACHED";

function printHelp() {
  console.log(`Usage:
  piw-public <port> --ip <IPv4> [--wait]
  piw-public <port> --tailscale [--wait]

Restarts the managed piw bridge on the selected port, binds it to an explicit
IPv4 address or the address detected through Tailscale, creates a new
authentication token, and displays the remote URL as text and as a QR code.

Options:
  --ip <IPv4>  Bind to this IPv4 address in addition to 127.0.0.1
  --tailscale  Detect and use the current Tailscale IPv4 address
  --wait       Wait for Enter before closing the terminal
  -h, --help
`);
}

function parseArguments(args) {
  let portValue;
  let address;
  let useTailscale = false;
  let waitForInput = false;
  let help = false;
  let error;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--wait") {
      waitForInput = true;
    } else if (arg === "--tailscale") {
      if (useTailscale || address) error = "Specify only one binding method.";
      useTailscale = true;
    } else if (arg === "--ip") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        error = "--ip requires an IPv4 address.";
      } else {
        if (useTailscale || address) error = "Specify only one binding method.";
        address = value;
        index += 1;
      }
    } else if (arg?.startsWith("-")) {
      error = `Unknown option: ${arg}`;
    } else if (portValue === undefined) {
      portValue = arg;
    } else {
      error = `Unexpected argument: ${arg}`;
    }
  }

  const port = parsePort(portValue);
  if (!help && !error && port === null) error = "A valid port argument is required.";
  if (!help && !error && !useTailscale && !address) {
    error = "Specify either --ip <IPv4> or --tailscale.";
  }
  if (!help && !error && address && !isIPv4(address)) {
    error = `Invalid IPv4 address: ${address}`;
  }
  return { address, error, help, port, useTailscale, wait: waitForInput };
}

const options = parseArguments(process.argv.slice(2));
const wait = options.wait;

async function pauseIfRequested() {
  if (!wait || !process.stdin.isTTY) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question("\nPress Enter to close...");
  } finally {
    rl.close();
  }
}

async function confirmBridgeStop(port) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `A piw bridge is already active on port ${port}. Stop it and continue? [y/N] `,
    );
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function fail(message, detail) {
  console.error(`Error: ${message}`);
  if (detail) console.error(detail.trim());
  await pauseIfRequested();
  process.exitCode = 1;
}

function parsePort(value) {
  if (!/^\d+$/.test(value ?? "")) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function tailscaleCandidates() {
  const candidates = [];
  if (process.env.TAILSCALE_BIN) candidates.push(process.env.TAILSCALE_BIN);
  candidates.push(process.platform === "win32" ? "tailscale.exe" : "tailscale");
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
      if (root) candidates.push(join(root, "Tailscale", "tailscale.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  }
  return [...new Set(candidates)];
}

function detectTailscaleIPv4() {
  let lastError = "";
  for (const command of tailscaleCandidates()) {
    const result = spawnSync(command, ["ip", "-4"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (result.error) {
      lastError = result.error.message;
      continue;
    }
    if (result.status !== 0) {
      lastError = result.stderr || `Tailscale exited with status ${result.status}.`;
      continue;
    }
    const address = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => isIPv4(line));
    if (address) return address;
    lastError = "Tailscale did not report an IPv4 address.";
  }
  throw new Error(lastError || "The Tailscale CLI was not found.");
}

function resolvePiwEntry() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "piw.js"),
    join(here, "..", "packages", "pi-webview", "dist", "piw.js"),
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) throw new Error("The piw executable bundle was not found.");
  return entry;
}

function piwEnvironment() {
  const env = { ...process.env };
  // This launcher must always rotate credentials instead of inheriting an
  // internal artifact-restart token or detached-launch state.
  delete env[RESTART_TOKEN_ENV];
  delete env[DETACHED_ENV];
  return env;
}

function runPiw(entry, piwArgs) {
  return spawnSync(process.execPath, [entry, ...piwArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: piwEnvironment(),
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

function readLiveBridge() {
  const lockPath = join(homedir(), ".pi", "pi-webview", "bridge.json");
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    process.kill(lock.pid, 0);
    if (!Number.isInteger(lock.port) || typeof lock.token !== "string") return null;
    return lock;
  } catch {
    return null;
  }
}

async function createLaunchUrl(address, port, token) {
  const response = await fetch(`http://127.0.0.1:${port}/launch-intent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-webview-token": token,
    },
    body: JSON.stringify({ cwd: process.cwd() }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`Launch registration failed with HTTP ${response.status}.`);
  const data = await response.json();
  if (!data || typeof data.id !== "string" || !data.id) {
    throw new Error("The bridge returned an invalid launch identifier.");
  }
  const url = new URL(`http://${address}:${port}/`);
  url.searchParams.set("token", token);
  url.searchParams.set("new", "1");
  url.searchParams.set("launch", data.id);
  return url.toString();
}

function renderQrCode(value) {
  return new Promise((resolve) => {
    qrcode.generate(value, { small: true }, (code) => resolve(code));
  });
}

if (options.help) {
  printHelp();
} else if (options.error || options.port === null) {
  printHelp();
  await fail(options.error || "A valid port argument is required.");
} else {
  const port = options.port;
  try {
    const address = options.useTailscale ? detectTailscaleIPv4() : options.address;
    if (!address) throw new Error("No binding address was selected.");

    const piwEntry = resolvePiwEntry();
    const previous = readLiveBridge();
    let shouldStart = true;

    if (previous) {
      const confirmed = await confirmBridgeStop(previous.port);
      if (!confirmed) {
        console.log("Cancelled. The existing piw bridge was not stopped.");
        shouldStart = false;
      } else {
        console.log(`Stopping the existing piw bridge on port ${previous.port}...`);
        const stopped = runPiw(piwEntry, ["-k"]);
        if (stopped.error || stopped.status !== 0) {
          throw new Error(
            stopped.stderr || stopped.error?.message || "Unable to stop piw.",
          );
        }
      }
    }

    if (shouldStart) {
      console.log(`Starting piw on ${address}:${port} with a new token...`);
      const started = runPiw(piwEntry, [
        "-b",
        "--port",
        String(port),
        "--ip",
        address,
        "--no-open",
        "--no-idle",
      ]);
      if (started.error || started.status !== 0) {
        throw new Error(
          started.stderr || started.error?.message || "Unable to start piw.",
        );
      }

      const bridge = readLiveBridge();
      if (!bridge || bridge.port !== port) {
        throw new Error("piw did not create a live bridge on the requested port.");
      }
      if (previous && bridge.token === previous.token) {
        throw new Error("piw unexpectedly reused the previous authentication token.");
      }

      const remoteUrl = await createLaunchUrl(address, port, bridge.token);
      const qrCode = await renderQrCode(remoteUrl);

      console.clear();
      console.log("PI WEB — REMOTE ACCESS");
      console.log(`Binding: ${address}:${port}\n`);
      console.log(`${remoteUrl}\n`);
      console.log(qrCode);
      console.log("Scan the QR code from a device that can reach the binding address.");
      console.log("The URL contains a private credential. Do not share it.");
    }
    await pauseIfRequested();
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  }
}
