// Real provider balance (like pi.dev / CodexBar): reads the pi API key and
// calls the balance endpoint of the provider's own API. The vendor is resolved
// from the API base URL, NOT from a hardcoded provider id, so built-in
// providers and user-defined ones pointing at the same API (e.g. a second
// DeepSeek key under a custom provider id) both report a balance.
// The key stays in the process (never sent to the UI): the webview only gets
// { currency, balance }.

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

export interface ProviderBalance {
  currency: "USD" | "CNY" | string;
  balance: number;
}

/** Balance API of one vendor: how to reach it from the provider's API base
 *  URL and how to read its (vendor-specific) payload. */
interface BalanceVendor {
  /** API host suffixes served by this vendor: any provider pointing at one of
   *  these hosts gets the same balance treatment. */
  hosts: string[];
  /** Balance endpoint derived from the provider's API base URL. */
  endpoint(base: URL): string;
  parse(payload: unknown): ProviderBalance | null;
}

const VENDORS: BalanceVendor[] = [
  {
    hosts: ["deepseek.com"],
    endpoint: (base) => `${base.origin}/user/balance`,
    parse: (payload) => {
      const infos = (
        payload as {
          balance_infos?: Array<{
            currency?: string;
            total_balance?: string | number;
          }> | null;
        } | null
      )?.balance_infos;
      if (!Array.isArray(infos)) return null;
      // prefer USD (like pi.dev), otherwise the first available currency
      const info = infos.find((i) => i?.currency === "USD") ?? infos[0];
      const balance = Number(info?.total_balance);
      if (!info?.currency || !Number.isFinite(balance)) return null;
      return { currency: info.currency, balance };
    },
  },
  {
    hosts: ["openrouter.ai"],
    endpoint: (base) => `${base.origin}/api/v1/credits`,
    parse: (payload) => {
      const data = (
        payload as {
          data?: {
            remaining_credits?: unknown;
            total_credits?: unknown;
            total_usage?: unknown;
          };
        } | null
      )?.data;
      if (!data) return null;
      const remaining = numberOrNull(data.remaining_credits);
      if (remaining !== null) return { currency: "USD", balance: remaining };
      // the endpoint dropped remaining_credits: derive it from credits - usage
      const total = numberOrNull(data.total_credits);
      const usage = numberOrNull(data.total_usage);
      if (total === null || usage === null) return null;
      return { currency: "USD", balance: total - usage };
    },
  },
];

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A resolved balance call: endpoint, credential and payload reader. */
export interface BalanceTarget {
  url: string;
  key: string;
  parse(payload: unknown): ProviderBalance | null;
}

function agentDir(): string {
  return process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** models.json entry of a provider (custom providers carry baseUrl/apiKey). */
function modelsProvider(provider: string): Record<string, unknown> | null {
  const models = readJsonObject(join(agentDir(), "models.json"));
  const providers = models?.providers;
  if (!providers || typeof providers !== "object") return null;
  const entry = (providers as Record<string, unknown>)[provider];
  return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
}

/** models.json also allows `$NAME` / `${NAME}` environment interpolation. */
function expandEnv(value: string): string | null {
  const expanded = value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, braced, bare) => process.env[braced ?? bare] ?? "",
  );
  return expanded.trim().length > 0 ? expanded : null;
}

/** Credential: pi's stored api_key first, then the models.json apiKey.
 *  `!command` values are never executed here. */
function readApiKey(provider: string): string | null {
  const auth = readJsonObject(join(agentDir(), "auth.json"));
  const stored = (auth?.[provider] as { key?: unknown } | undefined)?.key;
  if (typeof stored === "string" && stored.length > 0) return stored;

  const configured = modelsProvider(provider)?.apiKey;
  if (
    typeof configured === "string" &&
    configured.length > 0 &&
    !configured.startsWith("!")
  ) {
    return expandEnv(configured);
  }
  return null;
}

/** API base URL declared by the provider in models.json, when present. */
function configuredBaseUrl(provider: string): string | undefined {
  const baseUrl = modelsProvider(provider)?.baseUrl;
  return typeof baseUrl === "string" ? baseUrl : undefined;
}

function parseBaseUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function vendorForHost(hostname: string): BalanceVendor | null {
  const host = hostname.toLowerCase();
  return (
    VENDORS.find((vendor) =>
      vendor.hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)),
    ) ?? null
  );
}

/** Vendor serving an API base URL, or null when that API has no public
 *  balance endpoint. */
export function findBalanceVendor(apiBaseUrl: string | undefined): BalanceVendor | null {
  const base = parseBaseUrl(apiBaseUrl);
  return base ? vendorForHost(base.hostname) : null;
}

/** Resolves endpoint, credential and payload reader for a provider; null when
 *  the provider has no balance endpoint or no usable key. */
export function resolveBalanceTarget(
  provider: string,
  baseUrl?: string,
): BalanceTarget | null {
  // the caller (webview) passes the API base URL of the selected model;
  // models.json is the fallback so every host resolves it the same way
  const base = parseBaseUrl(baseUrl) ?? parseBaseUrl(configuredBaseUrl(provider));
  if (!base) return null;
  const vendor = vendorForHost(base.hostname);
  if (!vendor) return null;
  const key = readApiKey(provider);
  if (!key) return null;
  return { url: vendor.endpoint(base), key, parse: vendor.parse };
}

/** Balance for providers with a public endpoint; null for the others. */
export async function fetchProviderBalance(
  provider: string,
  baseUrl?: string,
): Promise<ProviderBalance | null> {
  const target = resolveBalanceTarget(provider, baseUrl);
  if (!target) return null;
  try {
    const res = await fetch(target.url, {
      headers: { Authorization: `Bearer ${target.key}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return target.parse(await res.json());
  } catch {
    // network/endpoint unreachable: no balance (the UI stays without it)
    return null;
  }
}

/** "$36.50" / "¥110.00" — formatting for the model chip */
export function formatBalance(b: ProviderBalance): string {
  const amount = b.balance.toFixed(2);
  return b.currency === "CNY" ? `¥${amount}` : `$${amount}`;
}
