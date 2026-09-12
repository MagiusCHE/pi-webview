import assert from "node:assert/strict";
import test from "node:test";
import {
  NPM_ALLOW_REMOTE_ENV,
  NPM_DANGEROUSLY_ALLOW_ALL_SCRIPTS_ENV,
  shouldAllowRemoteNpmUpdates,
  shouldDangerouslyAllowAllNpmScripts,
  updateChildEnvironment,
} from "../packages/pi-webview/lib/update-exec.ts";
import {
  hasBlockedNpmInstallScripts,
  hasRemoteNpmDependencyDisabledError,
  isBlockedNpmInstallScriptsUpdate,
  isRemoteNpmDependencyDisabledUpdate,
  updateExecutionOutcome,
} from "../src/ide/update-errors.ts";

test("remote npm dependencies require both explicit setting and Webview runtime", () => {
  assert.equal(shouldAllowRemoteNpmUpdates(true, { PI_WEBVIEW: "1" }), true);
  assert.equal(shouldAllowRemoteNpmUpdates(true, { PI_WEBVIEW_COMPANION: "1" }), true);
  assert.equal(shouldAllowRemoteNpmUpdates(false, { PI_WEBVIEW: "1" }), false);
  assert.equal(shouldAllowRemoteNpmUpdates(true, {}), false);
  assert.equal(shouldDangerouslyAllowAllNpmScripts(true, { PI_WEBVIEW: "1" }), true);
  assert.equal(shouldDangerouslyAllowAllNpmScripts(true, {}), false);
});

test("npm opt-ins are scoped to the update child without mutating its parent", () => {
  const base: NodeJS.ProcessEnv = {
    PATH: "/bin",
    [NPM_ALLOW_REMOTE_ENV]: "inherited-value",
  };
  const enabled = updateChildEnvironment(base, {
    allowRemote: true,
    dangerouslyAllowAllScripts: true,
  });
  const disabled = updateChildEnvironment(base, {
    allowRemote: false,
    dangerouslyAllowAllScripts: false,
  });
  assert.equal(enabled[NPM_ALLOW_REMOTE_ENV], "all");
  assert.equal(enabled[NPM_DANGEROUSLY_ALLOW_ALL_SCRIPTS_ENV], "true");
  assert.equal(disabled[NPM_ALLOW_REMOTE_ENV], "inherited-value");
  assert.equal(base[NPM_ALLOW_REMOTE_ENV], "inherited-value");
  assert.equal(base[NPM_DANGEROUSLY_ALLOW_ALL_SCRIPTS_ENV], undefined);
});

test("EALLOWREMOTE update failures are recognized for the localized hint", () => {
  assert.equal(hasRemoteNpmDependencyDisabledError("npm error code EALLOWREMOTE"), true);
  assert.equal(
    isRemoteNpmDependencyDisabledUpdate(
      "pi-webview: update failed (exit 1). npm error code EALLOWREMOTE",
    ),
    true,
  );
  assert.equal(
    isRemoteNpmDependencyDisabledUpdate(
      'pi-webview: update failed. Fetching packages of type "remote" have been disabled',
    ),
    true,
  );
  assert.equal(isRemoteNpmDependencyDisabledUpdate("npm error code EALLOWREMOTE"), false);
  assert.equal(isRemoteNpmDependencyDisabledUpdate("pi-webview: update failed"), false);
});

test("blocked npm install-script warnings are recognized after a successful update", () => {
  const output = `pi-webview: update finished. Restart pi to load the new version.
 npm warn install-scripts 2 packages had install scripts blocked because they are not covered by allowScripts:`;
  assert.equal(hasBlockedNpmInstallScripts(output), true);
  assert.equal(isBlockedNpmInstallScriptsUpdate(output), true);
  assert.equal(updateExecutionOutcome(output), "success");
  assert.equal(
    isBlockedNpmInstallScriptsUpdate(
      "npm warn install-scripts: install scripts blocked because they are not covered by allowScripts",
    ),
    false,
  );
});

test("update execution outcomes are distinct from version-check notifications", () => {
  assert.equal(
    updateExecutionOutcome("pi-webview: update finished. Restart pi to load it."),
    "success",
  );
  assert.equal(
    updateExecutionOutcome("pi-webview: update failed (exit 1). npm error"),
    "failure",
  );
  assert.equal(updateExecutionOutcome("pi-webview: update check failed: offline"), null);
  assert.equal(updateExecutionOutcome("pi-webview: updates available."), null);
});
