export const NPM_ALLOW_REMOTE_ENV = "npm_config_allow_remote";
export const NPM_DANGEROUSLY_ALLOW_ALL_SCRIPTS_ENV =
  "npm_config_dangerously_allow_all_scripts";

function isWebviewRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.PI_WEBVIEW === "1" || env.PI_WEBVIEW_COMPANION === "1";
}

/** Webview-only setting: terminal pi sessions must never inherit this opt-in. */
export function shouldAllowRemoteNpmUpdates(
  settingEnabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return settingEnabled && isWebviewRuntime(env);
}

/** Webview-only setting: terminal pi sessions must never inherit this opt-in. */
export function shouldDangerouslyAllowAllNpmScripts(
  settingEnabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return settingEnabled && isWebviewRuntime(env);
}

/** Add npm security overrides only to the update child process. */
export function updateChildEnvironment(
  env: NodeJS.ProcessEnv,
  permissions: {
    allowRemote: boolean;
    dangerouslyAllowAllScripts: boolean;
  },
): NodeJS.ProcessEnv {
  if (!permissions.allowRemote && !permissions.dangerouslyAllowAllScripts) return env;
  return {
    ...env,
    ...(permissions.allowRemote ? { [NPM_ALLOW_REMOTE_ENV]: "all" } : {}),
    ...(permissions.dangerouslyAllowAllScripts
      ? { [NPM_DANGEROUSLY_ALLOW_ALL_SCRIPTS_ENV]: "true" }
      : {}),
  };
}
