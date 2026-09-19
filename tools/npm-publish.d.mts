export const NPMJS_REGISTRY: string;
export const NPM_AUTH_TIMEOUT_MS: number;

export interface NpmPublication {
  metadata: {
    name: string;
    version: string;
    dist: {
      tarball: string;
      integrity?: string;
      shasum?: string;
    };
  };
  url: string;
}

export interface NpmPublishResult extends NpmPublication {
  published: boolean;
}

export function npmCommand(platformName?: string): string;
export function parseNpmAuthChallenge(
  output: string,
): { authUrl: string; doneUrl: string } | null;
export function parseNpmWebLoginUrl(output: string): string | null;
export function parseNpmPackOutput(output: string): string;
export function npmVersionUrl(registry: string, name: string, version: string): string;
export function npmFailureCode(output: string, status?: number | null): string;
export function openExternalUrl(url: string, options?: unknown): Promise<void>;
export function runNpm(
  args: string[],
  options?: unknown,
): {
  status: number | null;
  stdout: string;
  stderr: string;
};
export function ensureNpmAuthentication(options?: {
  [key: string]: unknown;
}): Promise<void>;
export function waitForNpmWebToken(doneUrl: string, options?: unknown): Promise<string>;
export function readNpmPublication(options: {
  name: string;
  version: string;
  [key: string]: unknown;
}): Promise<NpmPublication | null>;
export function verifyNpmPublication(options: {
  name: string;
  version: string;
  [key: string]: unknown;
}): Promise<NpmPublication>;
export function publishAndVerifyNpmPackage(options: {
  packageDir: string;
  tarballPath: string;
  name: string;
  version: string;
  [key: string]: unknown;
}): Promise<NpmPublishResult>;
