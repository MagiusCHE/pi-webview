// Shared pi CLI flag discovery and launch argument tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cliFlagArgs, parseAvailableCliFlags } from "../src/bridge/cli-flags.ts";

test("parseAvailableCliFlags: reads boolean and value flags from pi help", () => {
  const help = [
    "Usage: pi [options]",
    "",
    "Extension CLI Flags:",
    "  --session-control  Enable session control",
    "  --mcp-config <value>  MCP configuration path",
    "  --preset <value>  Preset name",
    "",
    "Other section:",
    "  --ignored  Not an extension flag",
  ].join("\r\n");

  assert.deepEqual(parseAvailableCliFlags(help), [
    {
      name: "session-control",
      type: "boolean",
      description: "Enable session control",
    },
    {
      name: "mcp-config",
      type: "string",
      description: "MCP configuration path",
    },
    {
      name: "preset",
      type: "string",
      description: "Preset name",
    },
  ]);
});

test("parseAvailableCliFlags: strips ANSI and returns empty without the section", () => {
  const help = "\u001b[1mExtension CLI Flags:\u001b[0m\n  --enabled  Enabled\n\n";
  assert.equal(parseAvailableCliFlags(help)[0]?.name, "enabled");
  assert.deepEqual(parseAvailableCliFlags("Usage: pi"), []);
});

test("cliFlagArgs: includes only active booleans and non-empty values", () => {
  assert.deepEqual(
    cliFlagArgs({
      "session-control": true,
      disabled: false,
      preset: "fast",
      "mcp-config": "",
    }),
    ["--session-control", "--preset", "fast"],
  );
});
