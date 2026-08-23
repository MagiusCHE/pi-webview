// Gestione del processo `pi --mode rpc` condivisa tra bridge standalone e
// adapter IDE: spawn, parsing JSONL, backpressure sullo stdin, restart con
// backoff. (concept 0002 D3/D5)

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createJsonlParser, writeJsonl } from "./jsonl.ts";

export interface PiProcessOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  args?: string[];
}

export interface PiProcessCallbacks {
  onEvent: (event: Record<string, unknown>) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStderr?: (line: string) => void;
  log?: (msg: string) => void;
}

export class PiProcess {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private stopping = false;
  private restarts = 0;
  private sending = false;
  private queue: unknown[] = [];
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private command: string;
  private cb: PiProcessCallbacks;
  private opts: PiProcessOptions;

  // niente parameter properties nel constructor: non supportate dallo
  // strip-only TS di Node (src/bridge/ è eseguita direttamente da Node)
  constructor(command: string, cb: PiProcessCallbacks, opts: PiProcessOptions = {}) {
    this.command = command;
    this.cb = cb;
    this.opts = opts;
  }

  get running(): boolean {
    return this.child !== null;
  }

  start(): void {
    const args = ["--mode", "rpc", ...(this.opts.args ?? [])];
    this.cb.log?.(`spawn: ${this.command} ${args.join(" ")}`);
    // su Windows pi è uno shim .cmd: va eseguito tramite cmd /c
    // (Node quotta gli argomenti in modo sicuro quando shell è false)
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", this.command, ...args], {
            stdio: ["pipe", "pipe", "pipe"],
            ...(this.opts.env ? { env: this.opts.env } : {}),
            ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
          })
        : spawn(this.command, args, {
            stdio: ["pipe", "pipe", "pipe"],
            ...(this.opts.env ? { env: this.opts.env } : {}),
            ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
          });
    this.child = child;

    child.stdin.on("error", (err) => {
      if (!this.stopping) this.cb.log?.(`stdin pi: ${err.message}`);
    });

    const parser = createJsonlParser((line) => {
      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        this.cb.log?.(`riga non JSON da pi, ignorata: ${line.slice(0, 120)}`);
        return;
      }
      this.cb.onEvent(payload as Record<string, unknown>);
    });
    child.stdout.on("data", (chunk: Buffer) => parser.push(chunk));
    child.stdout.on("end", () => parser.flush());

    child.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (line.trim()) this.cb.onStderr?.(line);
      }
    });

    // dopo 30s di vita il processo è considerato stabile: azzera il contatore
    this.stabilityTimer = setTimeout(() => {
      this.restarts = 0;
    }, 30_000);

    child.on("exit", (code, signal) => {
      if (this.stabilityTimer) {
        clearTimeout(this.stabilityTimer);
        this.stabilityTimer = null;
      }
      this.child = null;
      if (this.stopping) return;
      this.restarts++;
      if (this.restarts > 5) {
        this.cb.log?.("pi continua a crashare — mi fermo");
        this.cb.onExit?.(code, signal);
        return;
      }
      this.cb.log?.(`pi terminato (code=${code}, signal=${signal}); restart tra 1s`);
      setTimeout(() => this.start(), 1_000);
    });
  }

  send(obj: unknown): void {
    this.queue.push(obj);
    this.pump();
  }

  private pump(): void {
    if (this.sending || !this.child || !this.child.stdin.writable) return;
    const item = this.queue.shift();
    if (item === undefined) return;
    this.sending = true;
    const ok = writeJsonl(this.child.stdin, item);
    if (ok) {
      this.sending = false;
      this.pump();
    } else {
      this.child.stdin.once("drain", () => {
        this.sending = false;
        this.pump();
      });
    }
  }

  dispose(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }
}
