// Browser-only deterministic transport for the real UI recovery smoke test.
import assert from "node:assert/strict";

export async function runSessionRecoverySmoke({ call, evaluate, waitFor, url }) {
  await call("Page.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(${installSessionRecoveryFixture.toString()})()`,
  });
  await call("Page.navigate", {
    url: url.replace("__chat-search-smoke", "__chat-search-demo") + "?lang=en",
  });
  await waitFor(
    () =>
      evaluate(
        "window.recoveryFixture?.requests.filter(type => type === 'get_state').length > 21",
      ),
    "readiness retries beyond the original deadline",
  ).catch(async (error) => {
    console.error(
      await evaluate(
        "JSON.stringify({fixture: Boolean(window.recoveryFixture), requests: window.recoveryFixture?.requests, url: location.pathname, visibility: document.visibilityState})",
      ),
    );
    throw error;
  });
  assert.equal(await evaluate("document.getElementById('input').disabled"), true);
  assert.equal(
    await evaluate("Boolean(document.querySelector('.session-recovery-notice'))"),
    true,
  );
  assert.equal(
    await evaluate("recoveryFixture.requests.includes('get_messages')"),
    false,
  );
  await evaluate("recoveryFixture.ready = true");
  await waitFor(
    () =>
      evaluate(
        "!document.getElementById('input').disabled && !document.querySelector('.session-recovery-notice')",
      ),
    "late Pi readiness fully recovers the UI",
  );
  assert.equal(
    await evaluate(
      "document.getElementById('model-info').textContent.includes('Recovered Model')",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "document.body.textContent.includes('MCP recovered') && document.body.textContent.includes('account recovered')",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "document.getElementById('session-btn').textContent.includes('Recovered session 1')",
    ),
    true,
  );
  assert.ok(
    await evaluate(
      "recoveryFixture.requests.filter(type => type === 'get_messages').length >= 2",
    ),
    "failed history must be retried before the composer unlocks",
  );
  const historyReads = await evaluate(
    "recoveryFixture.requests.filter(type => type === 'get_messages').length",
  );
  await evaluate(`recoveryFixture.streaming = true;
    recoveryFixture.emit({type:'agent_start'});
    recoveryFixture.emit({type:'message_start', message:{role:'assistant',content:[],timestamp:2000}});
    recoveryFixture.emit({type:'message_update', assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'live partial response'}});
    document.dispatchEvent(new Event('visibilitychange'));`);
  await waitFor(
    () =>
      evaluate(
        "document.getElementById('thread').textContent.includes('live partial response')",
      ),
    "live response remains visible during metadata recovery",
  );
  assert.equal(
    await evaluate(
      "recoveryFixture.requests.filter(type => type === 'get_messages').length",
    ),
    historyReads,
  );
  await evaluate(
    "recoveryFixture.streaming = false; recoveryFixture.emit({type:'agent_settled'});",
  );
  await evaluate(
    "document.getElementById('session-btn').click(); document.querySelector('[data-action=new]').click()",
  );
  await waitFor(
    () =>
      evaluate(
        "recoveryFixture.session === 2 && !document.getElementById('input').disabled && document.getElementById('session-btn').textContent.includes('Recovered session 2')",
      ),
    "uncertain new-session outcome reconciled",
  );
  assert.equal(
    await evaluate(
      "recoveryFixture.requests.filter(type => type === 'new_session').length",
    ),
    1,
    "never replay the mutation",
  );
  await evaluate(
    "recoveryFixture.newSessionMode = 'cancel'; document.getElementById('session-btn').click(); document.querySelector('[data-action=new]').click()",
  );
  await waitFor(
    () => evaluate("!document.getElementById('input').disabled"),
    "extension cancellation unlocks the old session",
  );
  assert.equal(await evaluate("recoveryFixture.session"), 2);
  assert.equal(
    await evaluate(
      "recoveryFixture.requests.filter(type => ['prompt','steer','restartPi','set_model'].includes(type)).length",
    ),
    0,
  );
  console.log(
    "session recovery smoke: passed — late RPC readiness, model/context/status restore, no automatic mutation retries, new-session timeout/cancellation",
  );
}

export function installSessionRecoveryFixture() {
  const nativeTimeout = window.setTimeout.bind(window);
  const delays = new Map([
    [3000, 20],
    [1500, 5],
    [30000, 50],
    [90000, 100],
    [5000, 20],
    [10000, 40],
    [8000, 35],
  ]);
  window.setTimeout = (callback, delay, ...args) =>
    nativeTimeout(callback, delays.get(delay) ?? delay, ...args);
  const model = {
    provider: "fixture",
    id: "recovered",
    name: "Recovered Model",
    input: ["text"],
    contextWindow: 10000,
  };
  const fixture = (window.recoveryFixture = {
    ready: false,
    streaming: false,
    historyFailuresRemaining: 1,
    requests: [],
    newSessionMode: "timeout",
    session: 1,
    emit(payload) {
      window.dispatchEvent(
        new MessageEvent("message", { data: { channel: "rpc", payload } }),
      );
    },
  });
  const sessionPath = () => `/fixture/session-${fixture.session}.jsonl`;
  const info = () => ({
    path: sessionPath(),
    name: `Recovered session ${fixture.session}`,
    cwd: "/fixture",
    messageCount: 2,
  });
  window.acquireVsCodeApi = () => ({
    getState() {
      return {};
    },
    setState() {},
    postMessage(frame) {
      const request = frame.payload;
      fixture.requests.push(request.type);
      const reply = (data, success = true) =>
        nativeTimeout(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              data:
                frame.channel === "rpc"
                  ? {
                      channel: "rpc",
                      payload: {
                        type: "response",
                        id: request.id,
                        command: request.type,
                        success,
                        data,
                      },
                    }
                  : { channel: "ide", payload: { id: request.id, ok: success, data } },
            }),
          );
        }, 0);
      if (frame.channel === "ide") {
        const data = {
          getConfig: {
            theme: "dark",
            locale: "en",
            historyLimit: 120,
            notifications: "off",
            statsBarCompact: false,
            statsBarPosition: "above",
          },
          getWorkspace: { workspace: "/fixture" },
          getTrust: null,
          listSessions: { workspace: "/fixture", sessions: [info()] },
          getSessionInfo: info(),
          getThinkingSettings: { hideThinkingBlock: false },
          getCompactionSettings: { enabled: true, reserveTokens: 1000 },
          getSessionSettings: {},
          getSettings: { settings: [] },
          getVersion: { version: "fixture" },
          getBalance: null,
          getStartupInfo: {
            info: { contextFiles: [], skills: [], extensions: [] },
            statusSnapshot: [
              { statusKey: "mcp", statusText: "MCP recovered" },
              { statusKey: "account", statusText: "account recovered" },
            ],
          },
        };
        reply(data[request.type] ?? null);
        return;
      }
      if (request.type === "new_session") {
        if (fixture.newSessionMode === "cancel") reply({ cancelled: true });
        else {
          // Mutation succeeds, but its acknowledgement is lost. Never resend it.
          fixture.session++;
        }
        return;
      }
      if (!fixture.ready) return;
      switch (request.type) {
        case "get_state":
          reply({
            sessionFile: sessionPath(),
            sessionName: info().name,
            model,
            thinkingLevel: "medium",
            autoCompactionEnabled: true,
            isStreaming: fixture.streaming,
          });
          break;
        case "get_messages":
          if (fixture.historyFailuresRemaining > 0) {
            fixture.historyFailuresRemaining--;
            reply(null, false);
            break;
          }
          reply({
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "existing message" }],
                timestamp: 1000,
              },
            ],
          });
          break;
        case "get_entries":
          reply({ entries: [] });
          break;
        case "get_session_stats":
          reply({
            cost: 0,
            contextUsage: { tokens: 320, contextWindow: 10000, percent: 3.2 },
          });
          break;
        case "get_available_models":
          reply({ models: [model] });
          break;
        case "get_available_thinking_levels":
          reply({ levels: ["medium"] });
          break;
        case "get_commands":
          reply({ commands: [] });
          break;
        default:
          reply({});
      }
    },
  });
}
