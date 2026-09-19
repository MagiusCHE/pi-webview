import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureNpmAuthentication,
  npmFailureCode,
  npmVersionUrl,
  parseNpmAuthChallenge,
  parseNpmWebLoginUrl,
  parseNpmPackOutput,
  publishAndVerifyNpmPackage,
  readNpmPublication,
  verifyNpmPublication,
  waitForNpmWebToken,
} from "../tools/npm-publish.mjs";

const response = (status: number, body: unknown, retryAfter?: string) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (name: string) => (name === "retry-after" ? (retryAfter ?? null) : null),
  },
  json: async () => body,
});

const preparedIntegrity = "sha512-prepared";
const preparedShasum = "prepared-sha1";
const npmPackage = {
  name: "@magiusche/pi-webview",
  version: "0.5.0",
  dist: {
    tarball: "https://registry.npmjs.org/@magiusche/pi-webview/-/pi-webview-0.5.0.tgz",
    integrity: preparedIntegrity,
    shasum: preparedShasum,
  },
};

test("release auth parses structured npm browser challenges without accepting masked URLs", () => {
  const challenge = parseNpmAuthChallenge(
    JSON.stringify({
      error: {
        authUrl: "https://www.npmjs.com/auth/cli/12345678-1234-1234-1234-123456789abc",
        doneUrl:
          "https://registry.npmjs.org/-/v1/done?authId=12345678-1234-1234-1234-123456789abc",
      },
    }),
  );
  assert.deepEqual(challenge, {
    authUrl: "https://www.npmjs.com/auth/cli/12345678-1234-1234-1234-123456789abc",
    doneUrl:
      "https://registry.npmjs.org/-/v1/done?authId=12345678-1234-1234-1234-123456789abc",
  });
  assert.equal(
    parseNpmAuthChallenge(
      JSON.stringify({
        error: {
          authUrl: "https://www.npmjs.com/auth/cli/***",
          doneUrl: "https://registry.npmjs.org/-/v1/done?authId=***",
        },
      }),
    ),
    null,
  );
  assert.equal(
    parseNpmAuthChallenge(
      JSON.stringify({
        error: {
          authUrl: "https://attacker.example/auth",
          doneUrl: "https://registry.npmjs.org/-/v1/done?authId=123",
        },
      }),
    ),
    null,
  );
});

test("release auth opens only the canonical npm browser-login URL", () => {
  assert.equal(
    parseNpmWebLoginUrl(
      JSON.stringify({
        loginUrl:
          "https://www.npmjs.com/login?next=%2Flogin%2Fcli%2F12345678-1234-1234-1234-123456789abc",
      }),
    ),
    "https://www.npmjs.com/login?next=%2Flogin%2Fcli%2F12345678-1234-1234-1234-123456789abc",
  );
  assert.equal(
    parseNpmWebLoginUrl(
      JSON.stringify({ url: "https://attacker.example/login?next=/login/cli/123" }),
    ),
    null,
  );
});

test("release auth encodes the exact scoped npm version endpoint", () => {
  assert.equal(
    npmVersionUrl("https://registry.npmjs.org/", "@magiusche/pi-webview", "0.5.0"),
    "https://registry.npmjs.org/%40magiusche%2Fpi-webview/0.5.0",
  );
  assert.throws(
    () => npmVersionUrl("file:///tmp/registry", "@magiusche/pi-webview", "0.5.0"),
    /HTTP\(S\)/,
  );
});

test("release auth starts browser login only when the npm preflight is unauthenticated", async () => {
  const results = [
    { status: 1, stdout: "", stderr: "npm error code E401" },
    { status: 0, stdout: "publisher", stderr: "" },
  ];
  let loginArgs: unknown;
  await ensureNpmAuthentication({
    logger: { log() {} },
    run: () => results.shift()!,
    login: async (options: unknown) => {
      loginArgs = options;
    },
  });
  const loginOptions = loginArgs as {
    registry: string;
    logger: { log: () => void };
    openUrl: unknown;
  };
  assert.equal(loginOptions.registry, "https://registry.npmjs.org/");
  assert.equal(typeof loginOptions.logger.log, "function");
  assert.equal(typeof loginOptions.openUrl, "function");
});

test("release auth polls the npm completion endpoint and returns its ephemeral OTP", async () => {
  const responses = [
    response(202, { done: false }, "0.01"),
    response(200, { token: "temporary-otp" }),
  ];
  const delays: number[] = [];
  const token = await waitForNpmWebToken(
    "https://registry.npmjs.org/-/v1/done?authId=12345678-1234-1234-1234-123456789abc",
    {
      fetchImpl: async () => responses.shift()!,
      sleepImpl: async (milliseconds: number) => {
        delays.push(milliseconds);
      },
    },
  );
  assert.equal(token, "temporary-otp");
  assert.deepEqual(delays, [10]);
});

test("release verification retries registry propagation and validates package identity", async () => {
  const responses = [response(404, {}), response(200, npmPackage)];
  const delays: number[] = [];
  const publication = await verifyNpmPublication({
    name: "@magiusche/pi-webview",
    version: "0.5.0",
    integrity: preparedIntegrity,
    shasum: preparedShasum,
    fetchImpl: async () => responses.shift()!,
    sleepImpl: async (milliseconds: number) => {
      delays.push(milliseconds);
    },
    attempts: 2,
  });
  assert.equal(publication.metadata, npmPackage);
  assert.equal(
    publication.url,
    "https://registry.npmjs.org/%40magiusche%2Fpi-webview/0.5.0",
  );
  assert.deepEqual(delays, [2_000]);
});

test("release verification refuses incomplete or mismatched registry metadata", async () => {
  await assert.rejects(
    readNpmPublication({
      name: "@magiusche/pi-webview",
      version: "0.5.0",
      fetchImpl: async () => response(200, { ...npmPackage, version: "0.5.1" }),
    }),
    /different package version/,
  );
  await assert.rejects(
    readNpmPublication({
      name: "@magiusche/pi-webview",
      version: "0.5.0",
      fetchImpl: async () =>
        response(200, { name: npmPackage.name, version: npmPackage.version }),
    }),
    /without a tarball/,
  );
  await assert.rejects(
    readNpmPublication({
      name: "@magiusche/pi-webview",
      version: "0.5.0",
      integrity: "sha512-other",
      fetchImpl: async () => response(200, npmPackage),
    }),
    /integrity does not match/,
  );
  await assert.rejects(
    readNpmPublication({
      name: "@magiusche/pi-webview",
      version: "0.5.0",
      shasum: "other-sha1",
      fetchImpl: async () => response(200, npmPackage),
    }),
    /checksum does not match/,
  );
});

test("release publication authenticates first and verifies the exact registry version", async () => {
  const calls: Array<{ args: string[]; options?: { cwd?: string } }> = [];
  const responses = [response(404, {}), response(200, npmPackage)];
  const run = (args: string[], options?: { cwd?: string }) => {
    calls.push({ args, options });
    if (args[0] === "whoami") return { status: 0, stdout: "publisher", stderr: "" };
    if (args[0] === "publish") return { status: 0, stdout: "{}", stderr: "" };
    throw new Error(`unexpected npm command: ${args[0]}`);
  };

  const publication = await publishAndVerifyNpmPackage({
    packageDir: "/release/package",
    tarballPath: "/release/package/magiusche-pi-webview-0.5.0.tgz",
    integrity: preparedIntegrity,
    shasum: preparedShasum,
    name: npmPackage.name,
    version: npmPackage.version,
    tag: "next",
    logger: { log() {} },
    run,
    fetchImpl: async () => responses.shift()!,
  });

  assert.equal(publication.published, true);
  assert.deepEqual(
    calls.map(({ args }) => args[0]),
    ["whoami", "publish"],
  );
  assert.deepEqual(calls[1], {
    args: [
      "publish",
      "/release/package/magiusche-pi-webview-0.5.0.tgz",
      "--access",
      "public",
      "--registry",
      "https://registry.npmjs.org/",
      "--tag",
      "next",
      "--json",
    ],
    options: { cwd: "/release/package" },
  });
});

test("release publication completes npm browser 2FA without exposing the OTP", async () => {
  const calls: Array<{ args: string[]; options?: { env?: Record<string, string> } }> = [];
  const responses = [
    response(404, {}),
    response(200, { token: "test-ephemeral-otp" }),
    response(200, npmPackage),
  ];
  let publishAttempts = 0;
  const run = (args: string[], options?: { env?: Record<string, string> }) => {
    calls.push({ args, options });
    if (args[0] === "whoami") return { status: 0, stdout: "publisher", stderr: "" };
    if (args[0] !== "publish") throw new Error(`unexpected npm command: ${args[0]}`);
    publishAttempts += 1;
    if (publishAttempts === 1) {
      return {
        status: 1,
        stdout: JSON.stringify({
          error: {
            authUrl:
              "https://www.npmjs.com/auth/cli/12345678-1234-1234-1234-123456789abc",
            doneUrl:
              "https://registry.npmjs.org/-/v1/done?authId=12345678-1234-1234-1234-123456789abc",
          },
        }),
        stderr: "npm error code EOTP",
      };
    }
    return { status: 0, stdout: "{}", stderr: "" };
  };
  const opened: string[] = [];

  const publication = await publishAndVerifyNpmPackage({
    packageDir: "/release/package",
    tarballPath: "/release/package/magiusche-pi-webview-0.5.0.tgz",
    integrity: preparedIntegrity,
    shasum: preparedShasum,
    name: npmPackage.name,
    version: npmPackage.version,
    logger: { log() {} },
    run,
    openUrl: async (url: string) => {
      opened.push(url);
    },
    fetchImpl: async () => responses.shift()!,
  });

  assert.equal(publication.published, true);
  assert.deepEqual(opened, [
    "https://www.npmjs.com/auth/cli/12345678-1234-1234-1234-123456789abc",
  ]);
  assert.equal(publishAttempts, 2);
  assert.deepEqual(calls.at(-1)?.options?.env, { NPM_CONFIG_OTP: "test-ephemeral-otp" });
});

test("release pack parsing accepts the npm 11 array and npm 12 object shapes", () => {
  const entry = { filename: "magiusche-pi-webview-0.6.0.tgz", integrity: "sha512-x" };
  assert.equal(parseNpmPackOutput(JSON.stringify([entry])), entry.filename);
  assert.equal(
    parseNpmPackOutput(JSON.stringify({ "@magiusche/pi-webview": entry })),
    entry.filename,
  );
  assert.throws(() => parseNpmPackOutput("not json"), /JSON artifact metadata/);
  assert.throws(
    () => parseNpmPackOutput(JSON.stringify({ pkg: { size: 1 } })),
    /tarball filename/,
  );
});

test("release failures retain only an npm error code, never raw command output", () => {
  assert.equal(
    npmFailureCode("npm error code EOTP\nhttps://example.invalid/secret", 1),
    "EOTP",
  );
  assert.equal(npmFailureCode("unstructured failure", 2), "exit 2");
});
