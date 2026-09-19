import { spawn, spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

export const NPMJS_REGISTRY = "https://registry.npmjs.org/";
export const NPM_AUTH_TIMEOUT_MS = 10 * 60_000;
// A publish PUT can answer 202 Accepted and reach the public packument minutes later.
export const NPM_VERIFY_TIMEOUT_MS = 5 * 60_000;

const DEFAULT_POLL_MS = 2_000;
const MAX_POLL_MS = 10_000;
const NPMJS_WEB_HOST = "www.npmjs.com";
const NPMJS_REGISTRY_HOST = "registry.npmjs.org";

export const npmCommand = (platformName = platform()) =>
  platformName === "win32" ? "npm.cmd" : "npm";

const asHttpsUrl = (value) => {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.href.includes("*") ? url : null;
  } catch {
    return null;
  }
};

const jsonStringField = (output, field) => {
  const match = new RegExp(`"${field}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`).exec(output);
  if (!match?.[1]) return null;
  try {
    const value = JSON.parse(match[1]);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
};

export const parseNpmAuthChallenge = (output) => {
  const authUrl = asHttpsUrl(jsonStringField(output, "authUrl"));
  const doneUrl = asHttpsUrl(jsonStringField(output, "doneUrl"));
  if (
    !authUrl ||
    !doneUrl ||
    authUrl.hostname !== NPMJS_WEB_HOST ||
    doneUrl.hostname !== NPMJS_REGISTRY_HOST
  ) {
    return null;
  }
  return { authUrl: authUrl.href, doneUrl: doneUrl.href };
};

const npmWebLoginUrl = (value) => {
  const url = asHttpsUrl(value);
  if (
    !url ||
    url.hostname !== NPMJS_WEB_HOST ||
    url.pathname !== "/login" ||
    !url.searchParams.get("next")?.startsWith("/login/cli/")
  ) {
    return null;
  }
  return url;
};

export const parseNpmWebLoginUrl = (output) => {
  const structuredUrl =
    npmWebLoginUrl(jsonStringField(output, "url")) ??
    npmWebLoginUrl(jsonStringField(output, "loginUrl"));
  const textUrl = npmWebLoginUrl(
    /https:\/\/www\.npmjs\.com\/login\?next=\/login\/cli\/[0-9a-f-]{36}/.exec(
      output,
    )?.[0],
  );
  return (structuredUrl ?? textUrl)?.href ?? null;
};

export const npmVersionUrl = (registry, name, version) => {
  const base = new URL(registry);
  if (!/^https?:$/.test(base.protocol)) {
    throw new Error("npm registry must use HTTP(S)");
  }
  const prefix = base.href.endsWith("/") ? base.href : `${base.href}/`;
  return `${prefix}${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
};

export const npmFailureCode = (output, status) => {
  const code = /\b(?:ERR_[A-Z0-9_]+|E[A-Z][A-Z0-9_]*)\b/.exec(output)?.[0];
  return code ?? `exit ${status ?? "unknown"}`;
};

export const openExternalUrl = async (
  url,
  { platformName = platform(), spawnImpl = spawn } = {},
) => {
  const parsed = asHttpsUrl(url);
  if (!parsed) throw new Error("refusing to open a non-HTTPS URL");

  const [command, args] =
    platformName === "win32"
      ? ["cmd", ["/c", "start", "", parsed.href]]
      : platformName === "darwin"
        ? ["open", [parsed.href]]
        : ["xdg-open", [parsed.href]];

  await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

export const runNpm = (
  args,
  { cwd = homedir(), env = {}, spawnSyncImpl = spawnSync } = {},
) => {
  const result = spawnSyncImpl(npmCommand(), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`unable to start npm: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const commandOutput = (result) => `${result.stdout}\n${result.stderr}`;

const streamNpmLogin = ({
  registry,
  logger,
  openUrl,
  cwd = homedir(),
  env = {},
  timeoutMs = NPM_AUTH_TIMEOUT_MS,
  spawnImpl = spawn,
}) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let opened = false;
    let output = "";
    let timer;
    let child;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const fail = (message) =>
      finish(() => {
        child?.kill();
        reject(new Error(message));
      });

    try {
      child = spawnImpl(
        npmCommand(),
        ["login", "--auth-type=web", "--registry", registry],
        {
          cwd,
          env: { ...process.env, ...env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch (error) {
      fail(
        `unable to start npm browser login: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const observe = (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-16_384);
      if (opened) return;
      const url = parseNpmWebLoginUrl(output);
      if (!url) return;
      opened = true;
      logger.log("→ npm authentication requires the browser; opening it now…");
      Promise.resolve(openUrl(url)).catch(() => {
        fail("unable to open the npm authentication page");
      });
    };

    child.stdout?.on("data", observe);
    child.stderr?.on("data", observe);
    child.once("error", () => fail("npm browser login could not start"));
    child.once("close", (status) => {
      if (status === 0) {
        finish(resolve);
        return;
      }
      fail(
        opened
          ? "npm browser login did not complete successfully"
          : "npm browser login did not provide an authentication page",
      );
    });
    if (!settled) {
      timer = setTimeout(() => fail("npm browser authentication timed out"), timeoutMs);
    }
  });

export const ensureNpmAuthentication = async ({
  registry = NPMJS_REGISTRY,
  logger = console,
  run = runNpm,
  openUrl = openExternalUrl,
  login = streamNpmLogin,
}) => {
  const whoami = () => run(["whoami", "--registry", registry, "--json"]);
  if (whoami().status === 0) {
    logger.log("✓ npm authentication verified.");
    return;
  }

  logger.log("→ npm authentication is required before publishing.");
  await login({ registry, logger, openUrl });
  if (whoami().status !== 0) {
    throw new Error("npm authentication completed without a usable registry session");
  }
  logger.log("✓ npm authentication verified.");
};

const retryDelay = (response) => {
  const value = Number(response.headers?.get?.("retry-after"));
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_POLL_MS;
  return Math.min(Math.round(value * 1_000), MAX_POLL_MS);
};

export const waitForNpmWebToken = async (
  doneUrl,
  { fetchImpl = fetch, sleepImpl = sleep, timeoutMs = NPM_AUTH_TIMEOUT_MS } = {},
) => {
  const url = asHttpsUrl(doneUrl);
  if (!url)
    throw new Error("npm returned an invalid browser-authentication completion URL");

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => null);
    if (
      response.status === 200 &&
      typeof body?.token === "string" &&
      body.token.length > 0
    ) {
      return body.token;
    }
    if (response.status !== 202) {
      throw new Error("npm browser authentication was not accepted");
    }

    const delay = retryDelay(response);
    if (Date.now() + delay > deadline) {
      throw new Error("npm browser authentication timed out");
    }
    await sleepImpl(delay);
  }
};

export const parseNpmPackOutput = (output) => {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("npm pack did not return its JSON artifact metadata");
  }
  // npm <=11 returns an array of entries, npm 12 returns an object keyed by package name.
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
  const filename = entries
    .map((entry) => entry?.filename)
    .find((value) => typeof value === "string" && value.length > 0);
  if (!filename) throw new Error("npm pack did not report a tarball filename");
  return filename;
};

export const readNpmPublication = async ({
  registry = NPMJS_REGISTRY,
  name,
  version,
  integrity,
  shasum,
  allowArtifactMismatch = false,
  fetchImpl = fetch,
}) => {
  const url = npmVersionUrl(registry, name, version);
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`npm registry verification failed with HTTP ${response.status}`);
  }
  const metadata = await response.json();
  if (metadata?.name !== name || metadata.version !== version) {
    throw new Error("npm registry returned a different package version");
  }
  if (typeof metadata.dist?.tarball !== "string") {
    throw new Error("npm registry returned published metadata without a tarball");
  }
  // Companion artifacts embed build timestamps, so rebuilding the same commit
  // produces different tarball bytes. Recovery by an already published version
  // must keep the published artifact authoritative instead of failing.
  const integrityMatches = !integrity || metadata.dist.integrity === integrity;
  const shasumMatches = !shasum || metadata.dist.shasum === shasum;
  if (!allowArtifactMismatch && !integrityMatches) {
    throw new Error(
      "npm registry tarball integrity does not match the prepared artifact",
    );
  }
  if (!allowArtifactMismatch && !shasumMatches) {
    throw new Error("npm registry tarball checksum does not match the prepared artifact");
  }
  return { metadata, url, integrityMatches, shasumMatches };
};

export const verifyNpmPublication = async ({
  registry = NPMJS_REGISTRY,
  name,
  version,
  integrity,
  shasum,
  fetchImpl = fetch,
  sleepImpl = sleep,
  logger,
  timeoutMs = NPM_VERIFY_TIMEOUT_MS,
  attempts = 60,
}) => {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const publication = await readNpmPublication({
      registry,
      name,
      version,
      integrity,
      shasum,
      fetchImpl,
    });
    if (publication) return publication;

    const delay = Math.min(DEFAULT_POLL_MS * 2 ** attempt, MAX_POLL_MS);
    if (attempt + 1 >= attempts || Date.now() + delay > deadline) break;
    if (attempt === 0) {
      logger?.log(
        "→ npm registry is still processing the publish; waiting for it to appear…",
      );
    }
    await sleepImpl(delay);
  }
  throw new Error(
    `npm registry did not expose ${name}@${version} within ${Math.round(timeoutMs / 60_000)} minutes of publishing`,
  );
};

const publishArgs = ({ registry, tag, tarballPath }) => [
  "publish",
  tarballPath,
  "--access",
  "public",
  "--registry",
  registry,
  ...(tag ? ["--tag", tag] : []),
  "--json",
];

const publishFailure = (result) =>
  new Error(
    `npm publish failed (${npmFailureCode(commandOutput(result), result.status)})`,
  );

export const publishAndVerifyNpmPackage = async ({
  packageDir,
  tarballPath,
  integrity,
  shasum,
  name,
  version,
  tag,
  registry = NPMJS_REGISTRY,
  logger = console,
  run = runNpm,
  fetchImpl = fetch,
  sleepImpl = sleep,
  openUrl = openExternalUrl,
}) => {
  if (typeof tarballPath !== "string" || tarballPath.length === 0) {
    throw new Error("npm publication requires the prepared tarball path");
  }
  const existing = await readNpmPublication({
    registry,
    name,
    version,
    integrity,
    shasum,
    allowArtifactMismatch: true,
    fetchImpl,
  });
  if (existing) {
    if (!existing.integrityMatches || !existing.shasumMatches) {
      logger.log(
        `→ npm registry already contains ${name}@${version} from an earlier build; the published artifact stays authoritative.`,
      );
    } else {
      logger.log(`→ npm registry already contains ${name}@${version}; publish skipped.`);
    }
    return { ...existing, published: false };
  }

  await ensureNpmAuthentication({ registry, logger, run, openUrl });
  let result = run(publishArgs({ registry, tag, tarballPath }), { cwd: packageDir });
  if (result.status !== 0) {
    const challenge = parseNpmAuthChallenge(commandOutput(result));
    if (!challenge) throw publishFailure(result);

    logger.log("→ npm requires browser 2FA; opening the authorization page now…");
    await openUrl(challenge.authUrl);
    const otp = await waitForNpmWebToken(challenge.doneUrl, { fetchImpl, sleepImpl });
    result = run(publishArgs({ registry, tag, tarballPath }), {
      cwd: packageDir,
      env: { NPM_CONFIG_OTP: otp },
    });
  }

  if (result.status !== 0) {
    const recovered = await readNpmPublication({
      registry,
      name,
      version,
      integrity,
      shasum,
      fetchImpl,
    });
    if (recovered) return { ...recovered, published: false };
    throw publishFailure(result);
  }

  const publication = await verifyNpmPublication({
    registry,
    name,
    version,
    integrity,
    shasum,
    fetchImpl,
    sleepImpl,
    logger,
  });
  logger.log(`✓ npm registry verified ${name}@${version}.`);
  return { ...publication, published: true };
};
