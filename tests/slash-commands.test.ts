import assert from "node:assert/strict";
import test from "node:test";

import {
  isKnownSlashCommand,
  normalizeExtensionCommands,
  shouldAttachImplicitEditorContext,
  shouldBlockUnverifiedSlashCommand,
  slashCommandName,
} from "../src/web/slash-commands.ts";

test("extension command normalization keeps accounts and ignores other sources", () => {
  assert.deepEqual(
    normalizeExtensionCommands([
      {
        name: "accounts",
        source: "extension",
        description: "Open the interactive OAuth account manager",
      },
      { name: "/PIW", source: "extension", description: "Manage pi-webview" },
      { name: "compact", source: "builtin" },
      { name: "accounts", source: "extension", description: "duplicate" },
    ]),
    [
      {
        name: "accounts",
        description: "Open the interactive OAuth account manager",
      },
      { name: "PIW", description: "Manage pi-webview" },
    ],
  );
});

test("slash command matching is case-insensitive and supports arguments", () => {
  const commands = [{ name: "accounts", description: "OAuth accounts" }];
  assert.equal(slashCommandName(" /Accounts provider "), "accounts");
  assert.equal(isKnownSlashCommand("/accounts", commands), true);
  assert.equal(isKnownSlashCommand("/ACCOUNTS provider", commands), true);
  assert.equal(isKnownSlashCommand("/unknown", commands), false);
  assert.equal(isKnownSlashCommand("ordinary prompt", commands), false);
});

test("extension commands keep exact syntax and unverified commands fail closed", () => {
  assert.equal(shouldAttachImplicitEditorContext(true), false);
  assert.equal(shouldAttachImplicitEditorContext(false), true);
  assert.equal(
    shouldBlockUnverifiedSlashCommand({
      commandName: "accounts",
      isExtensionCommand: false,
      commandListAvailable: false,
    }),
    true,
  );
  assert.equal(
    shouldBlockUnverifiedSlashCommand({
      commandName: "accounts",
      isExtensionCommand: true,
      commandListAvailable: false,
    }),
    false,
  );
});

test("absolute Linux paths remain ordinary prompt text", () => {
  const commands = [{ name: "accounts", description: "OAuth accounts" }];
  assert.equal(slashCommandName("/home/user/project/file.ts needs a fix"), null);
  assert.equal(
    isKnownSlashCommand("/home/user/project/file.ts needs a fix", commands),
    false,
  );
});
