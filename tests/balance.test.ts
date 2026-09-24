import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchProviderBalance,
  findBalanceVendor,
  resolveBalanceTarget,
} from "../src/bridge/balance.ts";

/** Runs `fn` with PI_AGENT_DIR pointing at a throwaway agent directory. */
async function withAgentDir(
  files: { auth?: unknown; models?: unknown },
  fn: () => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "pi-webview-balance-"));
  if (files.auth) writeFileSync(join(dir, "auth.json"), JSON.stringify(files.auth));
  if (files.models) writeFileSync(join(dir, "models.json"), JSON.stringify(files.models));
  const previous = process.env.PI_AGENT_DIR;
  process.env.PI_AGENT_DIR = dir;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("balance: the endpoint follows the API host, not the provider id", async () => {
  await withAgentDir(
    {
      auth: { "deepseek-tabilia": { type: "api_key", key: "second-key" } },
      models: {
        providers: {
          "deepseek-tabilia": {
            baseUrl: "https://api.deepseek.com",
            api: "openai-completions",
            models: [{ id: "deepseek-flash" }],
          },
        },
      },
    },
    () => {
      // any provider id pointing at the API host resolves, custom ids included
      const target = resolveBalanceTarget("deepseek-tabilia", "https://api.deepseek.com");
      assert.ok(target, "custom provider without a balance target");
      assert.equal(target.url, "https://api.deepseek.com/user/balance");
      assert.equal(target.key, "second-key");
    },
  );
});

test("balance: models.json baseUrl is the fallback when the request omits it", async () => {
  await withAgentDir(
    {
      auth: { "any-name": { type: "api_key", key: "abc" } },
      models: { providers: { "any-name": { baseUrl: "https://api.deepseek.com/v1" } } },
    },
    () => {
      const target = resolveBalanceTarget("any-name");
      assert.equal(target?.url, "https://api.deepseek.com/user/balance");
    },
  );
});

test("balance: no target when the provider API has no balance endpoint", async () => {
  await withAgentDir(
    {
      auth: { "deepseek-proxy": { type: "api_key", key: "abc" } },
      models: {
        providers: { "deepseek-proxy": { baseUrl: "https://api.example.com/v1" } },
      },
    },
    () => {
      // the provider NAME looks like deepseek, the API host does not: no balance
      assert.equal(resolveBalanceTarget("deepseek-proxy"), null);
      assert.equal(findBalanceVendor("https://api.example.com/v1"), null);
    },
  );
});

test("balance: an unknown provider id on a known API host still resolves", async () => {
  await withAgentDir(
    { auth: { "openrouter-business": { type: "api_key", key: "or-key" } } },
    () => {
      const target = resolveBalanceTarget(
        "openrouter-business",
        "https://openrouter.ai/api/v1",
      );
      assert.equal(target?.url, "https://openrouter.ai/api/v1/credits");
      assert.equal(target?.key, "or-key");
    },
  );
});

test("balance: key from models.json (literal and $ENV)", async () => {
  await withAgentDir(
    {
      auth: {},
      models: {
        providers: {
          literal: { baseUrl: "https://api.deepseek.com", apiKey: "local-key" },
          fromEnv: {
            baseUrl: "https://api.deepseek.com",
            apiKey: "$PI_WEBVIEW_TEST_KEY",
          },
          fromCommand: {
            baseUrl: "https://api.deepseek.com",
            apiKey: "!pass show deepseek",
          },
        },
      },
    },
    () => {
      process.env.PI_WEBVIEW_TEST_KEY = "key-from-env";
      try {
        assert.equal(resolveBalanceTarget("literal")?.key, "local-key");
        assert.equal(resolveBalanceTarget("fromEnv")?.key, "key-from-env");
        // a `!command` credential is never executed by the bridge
        assert.equal(resolveBalanceTarget("fromCommand"), null);
      } finally {
        delete process.env.PI_WEBVIEW_TEST_KEY;
      }
    },
  );
});

test("balance: deepseek payload reader prefers USD", async () => {
  await withAgentDir({ auth: { p: { type: "api_key", key: "abc" } } }, () => {
    const target = resolveBalanceTarget("p", "https://api.deepseek.com");
    assert.ok(target);
    const payload = {
      balance_infos: [
        { currency: "CNY", total_balance: "110.00" },
        { currency: "USD", total_balance: "36.50" },
      ],
    };
    assert.deepEqual(target.parse(payload), { currency: "USD", balance: 36.5 });
    // first currency when USD is missing, numeric strings accepted
    assert.deepEqual(
      target.parse({ balance_infos: [{ currency: "CNY", total_balance: "7" }] }),
      {
        currency: "CNY",
        balance: 7,
      },
    );
    assert.equal(target.parse({}), null);
  });
});

test("balance: openrouter payload reader", async () => {
  await withAgentDir({ auth: { p: { type: "api_key", key: "abc" } } }, () => {
    const target = resolveBalanceTarget("p", "https://openrouter.ai/api/v1");
    assert.ok(target);
    assert.deepEqual(target.parse({ data: { remaining_credits: 12.34 } }), {
      currency: "USD",
      balance: 12.34,
    });
    // the endpoint dropped remaining_credits: credits - usage
    assert.deepEqual(
      target.parse({ data: { total_credits: 25.5, total_usage: 13.25 } }),
      {
        currency: "USD",
        balance: 12.25,
      },
    );
    assert.equal(target.parse({ data: { total_credits: 5 } }), null);
    assert.equal(target.parse({}), null);
  });
});

test("balance: no key or no endpoint never reaches the network", async () => {
  await withAgentDir({ auth: {}, models: { providers: {} } }, async () => {
    assert.equal(await fetchProviderBalance("no-key", "https://api.deepseek.com"), null);
    assert.equal(await fetchProviderBalance("no-host"), null);
  });
});
