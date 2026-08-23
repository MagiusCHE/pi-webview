// Saldo reale del provider (come pi.dev / CodexBar): legge la API key di pi
// da auth.json e chiama l'endpoint di balance del provider. La key resta nel
// processo (mai inviata alla UI): alla webview arriva solo { currency, balance }.

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

export interface ProviderBalance {
  currency: "USD" | "CNY" | string;
  balance: number;
}

function agentDir(): string {
  return process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function readApiKey(provider: string): string | null {
  try {
    const file = join(agentDir(), "auth.json");
    if (!existsSync(file)) return null;
    const auth = JSON.parse(readFileSync(file, "utf-8")) as Record<
      string,
      { type?: string; key?: string }
    >;
    const key = auth[provider]?.key;
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** Saldo per i provider con endpoint pubblico; null per gli altri. */
export async function fetchProviderBalance(
  provider: string,
): Promise<ProviderBalance | null> {
  const key = readApiKey(provider);
  if (!key) return null;
  try {
    if (provider === "deepseek") {
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        balance_infos?: Array<{ currency: string; total_balance: string }>;
      };
      const infos = data.balance_infos ?? [];
      // preferisci USD (come pi.dev), altrimenti la prima valuta disponibile
      const info = infos.find((i) => i.currency === "USD") ?? infos[0];
      if (!info) return null;
      return { currency: info.currency, balance: Number(info.total_balance) };
    }
    if (provider === "openrouter") {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        data?: { total_credits?: number; remaining_credits?: number };
      };
      const remaining = data.data?.remaining_credits;
      if (typeof remaining !== "number") return null;
      return { currency: "USD", balance: remaining };
    }
  } catch {
    // rete/endpoint non raggiungibili: niente saldo (la UI resta senza)
  }
  return null;
}

/** "$36.50" / "¥110.00" — formattazione per la chip del modello */
export function formatBalance(b: ProviderBalance): string {
  const amount = b.balance.toFixed(2);
  return b.currency === "CNY" ? `¥${amount}` : `$${amount}`;
}
