// Real provider balance (like pi.dev / CodexBar) — C# mirror of
// src/bridge/balance.ts: reads pi's API key from ~/.pi/agent/auth.json and
// calls the provider balance endpoint. The key stays in the process (never
// sent to the UI): the webview only receives { currency, balance }.

using System.Net.Http.Headers;
using System.Text.Json;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Platform;

public sealed class BalanceClient
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(15),
    };

    public static string AgentDir() =>
        Environment.GetEnvironmentVariable("PI_AGENT_DIR") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent");

    public static string? ReadApiKey(string provider)
    {
        try
        {
            var file = Path.Combine(AgentDir(), "auth.json");
            if (!File.Exists(file)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            if (!doc.RootElement.TryGetProperty(provider, out var entry)) return null;
            if (!entry.TryGetProperty("key", out var key) || key.ValueKind != JsonValueKind.String) return null;
            var k = key.GetString();
            return k is { Length: > 0 } ? k : null;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static async Task<ProviderBalance?> FetchProviderBalanceAsync(string provider)
    {
        var key = ReadApiKey(provider);
        if (key is null) return null;
        try
        {
            if (provider == "deepseek")
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, "https://api.deepseek.com/user/balance");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
                req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                using var res = await Http.SendAsync(req).ConfigureAwait(false);
                if (!res.IsSuccessStatusCode) return null;
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync().ConfigureAwait(false));
                if (!doc.RootElement.TryGetProperty("balance_infos", out var infos) ||
                    infos.ValueKind != JsonValueKind.Array) return null;
                // prefer USD (like pi.dev), otherwise the first currency
                JsonElement? chosen = null;
                foreach (var info in infos.EnumerateArray())
                {
                    if (info.TryGetProperty("currency", out var cur) && cur.GetString() == "USD")
                    {
                        chosen = info;
                        break;
                    }
                    chosen ??= info;
                }
                if (chosen is null) return null;
                var c = chosen.Value;
                if (!c.TryGetProperty("currency", out var currency) ||
                    !c.TryGetProperty("total_balance", out var total) ||
                    !double.TryParse(total.GetString(), out var balance)) return null;
                return new ProviderBalance { Currency = currency.GetString() ?? "USD", Balance = balance };
            }
            if (provider == "openrouter")
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, "https://openrouter.ai/api/v1/credits");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
                using var res = await Http.SendAsync(req).ConfigureAwait(false);
                if (!res.IsSuccessStatusCode) return null;
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync().ConfigureAwait(false));
                if (!doc.RootElement.TryGetProperty("data", out var data) ||
                    !data.TryGetProperty("remaining_credits", out var remaining) ||
                    remaining.ValueKind != JsonValueKind.Number) return null;
                return new ProviderBalance { Currency = "USD", Balance = remaining.GetDouble() };
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            // network/endpoint unreachable: no balance (the UI stays without)
        }
        return null;
    }
}
