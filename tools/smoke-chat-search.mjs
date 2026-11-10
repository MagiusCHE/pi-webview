// Run with node tools/smoke-chat-search.mjs. No bridge, model, or IDE install.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "vite";
import { runSessionRecoverySmoke } from "./session-recovery-fixture.mjs";
import { resolveChromeExecutable } from "../src/bridge/companions.ts";

const chrome = resolveChromeExecutable();
assert.ok(chrome, "Chrome/Chromium is required for the chat-search browser smoke test");
const profile = mkdtempSync(join(tmpdir(), "pi-webview-find-smoke-"));
const originalHtml = readFileSync("src/web/index.html", "utf8");
const html = originalHtml.replace(
  '<script type="module" src="/main.ts"></script>',
  `<script type="module">
    import { ChatSearch, collectChatSearchRanges } from '/chat-search.ts';
    import { setLocale } from '/i18n.ts';
    import { wrapToolOutputPreview } from '/tool-output-preview.ts';
    document.getElementById('boot-loader').hidden = true;
    const root = document.getElementById('thread');
    const viewport = document.getElementById('messages');
    root.innerHTML = '<div class="msg user">Needle <strong>formatted</strong> phrase. needle</div>' +
      '<div class="msg assistant"><p>🙂 CITTÀ needle</p>' +
      '<details><summary>Details</summary><p>hiddenword needle</p></details>' +
      '<div hidden>hiddenword</div><button>hiddenword</button></div>' +
      '<div class="msg assistant">first</div><div class="msg user">second</div>';
    window.smoke = { stop: 0, navigations: 0, locked: false };
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') window.smoke.stop++;
    });
    const search = new ChatSearch({ root, viewport,
      canOpen: () => !window.smoke.locked,
      onNavigate: () => window.smoke.navigations++,
    });
    window.smoke.search = search;
    window.smoke.collect = (query) => collectChatSearchRanges(root, query).map(range => range.toString());
    window.smoke.locale = (locale) => { setLocale(locale); search.refreshLocale(); };
    window.smoke.preview = () => {
      const text = document.createElement('div');
      text.className = 'presented-output-text';
      text.textContent = 'line one\\nline two\\nline three\\npreviewword';
      root.append(wrapToolOutputPreview(text));
    };
    setLocale('en'); search.refreshLocale();
    window.smoke.ready = true;
  </script>`,
);
assert.ok(html.includes("window.smoke.ready"), "the UI entry script must be replaced");
let server;
let browser;
let socket;
const pending = new Map();
let sequence = 0;

async function waitFor(action, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const value = await action();
      if (value) return value;
    } catch {
      // Browser startup and page navigation briefly invalidate the target.
    }
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function call(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function key(key, modifiers = 0) {
  const windowsVirtualKeyCode = { Enter: 13, Escape: 27, f: 70 }[key];
  const code = key === "f" ? "KeyF" : key;
  const params = { key, code, modifiers, windowsVirtualKeyCode };
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...params,
    ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
  });
  await call("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function query(value) {
  await evaluate(`document.getElementById('chat-search-input').value = ${JSON.stringify(value)};
    document.getElementById('chat-search-input').dispatchEvent(new Event('input', { bubbles: true }));`);
}
const count = () => evaluate("document.getElementById('chat-search-count').textContent");

try {
  server = await createServer({
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    plugins: [
      {
        name: "chat-search-smoke",
        configureServer(vite) {
          vite.middlewares.use("/__chat-search-smoke", (_request, response) => {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(html);
          });
          vite.middlewares.use("/__chat-search-demo", (_request, response) => {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(originalHtml);
          });
          vite.middlewares.use("/bridge-config.json", (_request, response) => {
            response.statusCode = 503;
            response.end();
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/__chat-search-smoke`;
  browser = spawn(
    chrome,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  browser.on("error", (error) => {
    console.error(error.message);
  });
  const debugPort = await waitFor(
    () =>
      Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]),
    "Chrome debugging port",
  );
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await once(socket, "open");
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      console.error(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await call("Runtime.enable");
  await call("Page.navigate", { url });
  await waitFor(() => evaluate("window.smoke?.ready"), "search UI initialization");

  assert.deepEqual(await evaluate("smoke.collect('needle formatted phrase')"), [
    "Needle formatted phrase",
  ]);
  assert.deepEqual(await evaluate("smoke.collect('hiddenword')"), []);
  assert.deepEqual(await evaluate("smoke.collect('first second')"), []);
  assert.deepEqual(await evaluate("smoke.collect('città')"), ["CITTÀ"]);

  await evaluate(
    "document.getElementById('input').value = 'unsent draft'; document.getElementById('input').focus()",
  );
  await key("f", 2);
  assert.equal(await evaluate("document.activeElement.id"), "chat-search-input");
  await query("needle");
  assert.equal(await count(), "1 of 3");
  assert.equal(await evaluate("CSS.highlights.get('chat-search-matches').size"), 3);
  const original = await evaluate("document.getElementById('thread').innerHTML");
  await key("Enter");
  assert.equal(await count(), "2 of 3");
  await key("Enter", 8);
  assert.equal(await count(), "1 of 3");
  await key("Enter", 8);
  assert.equal(await count(), "3 of 3");
  assert.equal(await evaluate("document.getElementById('thread').innerHTML"), original);

  await evaluate("document.querySelector('details').open = true");
  await waitFor(async () => (await count()) === "3 of 4", "expanded details indexed");
  await evaluate("document.getElementById('thread').lastElementChild.append(' needle')");
  await waitFor(async () => (await count()) === "3 of 5", "streaming text indexed");
  await evaluate("document.getElementById('thread').firstElementChild.remove()");
  await waitFor(async () => (await count()) === "1 of 3", "removed history discarded");
  await evaluate("document.getElementById('chat-search-prev').focus()");
  await key("Enter");
  assert.equal(await count(), "3 of 3", "Enter activates the focused previous button");
  await evaluate("document.getElementById('chat-search-input').focus()");
  await query("[<script>].*");
  assert.equal(await count(), "No results");
  assert.equal(
    await evaluate("document.getElementById('chat-search-next').disabled"),
    true,
  );

  await evaluate("smoke.preview()");
  await query("previewword");
  assert.equal(
    await evaluate(
      "document.querySelector('.presented-output-preview').classList.contains('is-expanded')",
    ),
    true,
  );
  await key("Escape");
  assert.equal(await evaluate("smoke.stop"), 0);
  assert.equal(await evaluate("document.activeElement.id"), "input");
  assert.equal(await evaluate("document.getElementById('input').value"), "unsent draft");
  assert.equal(await evaluate("CSS.highlights.has('chat-search-matches')"), false);
  await key("Escape");
  assert.equal(await evaluate("smoke.stop"), 1);

  for (const [width, height] of [
    [1280, 800],
    [768, 1024],
    [375, 812],
  ]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const theme of ["dark", "light"]) {
      await evaluate(
        `document.documentElement.dataset.theme = '${theme}'; document.getElementById('btn-chat-search').click()`,
      );
      await query("needle");
      assert.equal(
        await evaluate("document.documentElement.scrollWidth <= innerWidth"),
        true,
        `no page overflow at ${width}/${theme}`,
      );
      assert.equal(
        await evaluate(
          "document.getElementById('chat-search-input').getBoundingClientRect().width > 50",
        ),
        true,
      );
      assert.equal(
        await evaluate(
          "document.getElementById('chat-search-input').getAttribute('aria-label')",
        ),
        "Find in chat",
      );
      await key("Escape");
    }
  }

  await key("f", 4);
  assert.equal(await evaluate("smoke.search.isOpen"), true, "Cmd+F");
  await evaluate("smoke.locale('it')");
  assert.equal(
    await evaluate(
      "document.getElementById('chat-search-input').getAttribute('aria-label')",
    ),
    "Cerca nella chat",
  );
  await evaluate("smoke.search.close(); smoke.locked = true");
  await key("f", 2);
  assert.equal(await evaluate("smoke.search.isOpen"), false, "session loading lock");
  await evaluate(
    "smoke.locked = false; document.getElementById('settings-modal').hidden = false",
  );
  await key("f", 2);
  assert.equal(await evaluate("smoke.search.isOpen"), false, "modal focus is respected");
  await evaluate(
    "document.getElementById('settings-modal').hidden = true; document.getElementById('thread').replaceChildren(); smoke.search.open()",
  );
  await query("needle");
  assert.equal(await count(), "Nessun risultato");
  await evaluate("document.getElementById('chat-search-close').focus()");
  await key("Enter");
  assert.equal(
    await evaluate("smoke.search.isOpen"),
    false,
    "Enter activates the close button",
  );

  // Load the real application entry point as well, with no bridge behind it.
  await call("Page.navigate", {
    url: url.replace("__chat-search-smoke", "__chat-search-demo") + "?demo=1&lang=en",
  });
  await waitFor(
    () =>
      evaluate(
        "document.getElementById('btn-chat-search')?.title.includes('Find in chat') && document.getElementById('thread').children.length > 0",
      ),
    "real application initialization",
  );
  await evaluate(`document.getElementById('thread').innerHTML = '<div class="msg assistant">' +
    Array.from({length: 100}, (_, index) => '<p>' + (index === 10 ? 'scrolltarget' : 'filler line') + '</p>').join('') + '</div>'`);
  await sleep(200);
  await key("f", 2);
  await query("scrolltarget");
  assert.equal(await count(), "1 of 1");
  const top = await evaluate("document.getElementById('messages').scrollTop");
  assert.ok(top > 0, "find scrolls the real chat to the match");
  await evaluate(
    "document.querySelector('#thread .msg').insertAdjacentHTML('beforeend', '<p>streaming growth</p>'.repeat(20))",
  );
  await sleep(250);
  assert.equal(
    await evaluate("document.getElementById('messages').scrollTop"),
    top,
    "streaming must not pull search back to the bottom",
  );
  await key("Escape");
  assert.equal(await evaluate("document.getElementById('chat-search').hidden"), true);
  console.log(
    "chat search smoke: passed — real app integration, DOM ranges, highlighting, shortcuts, streaming/scroll, focus, modal/session locks, 3 viewports × 2 themes, IT/EN",
  );
  await runSessionRecoverySmoke({ call, evaluate, waitFor, url });
} finally {
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (browser && browser.exitCode === null) {
    const exited = once(browser, "exit");
    browser.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  await server?.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
