// Real provider balance (like pi.dev / CodexBar) — C# mirror of
// src/bridge/balance.ts: reads pi's API key and calls the balance endpoint of
// the provider's own API. The vendor is resolved from the API base URL, NOT
// from a hardcoded provider id, so built-in providers and user-defined ones
// pointing at the same API (e.g. a second DeepSeek key under a custom provider
// id) both report a balance. The key stays in the process (never sent to the
// UI): the webview only receives { currency, balance }.

using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Platform;

public sealed class BalanceClient
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(15),
    };

    /// <summary>models.json allows `$NAME` / `${NAME}` environment interpolation.</summary>
    private static readonly Regex EnvPattern = new(
        @"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)",
        RegexOptions.Compiled);

    public static string AgentDir() =>
        Environment.GetEnvironmentVariable("PI_AGENT_DIR") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent");

    private static JsonDocument? ReadJson(string file)
    {
        try
        {
            return File.Exists(file) ? JsonDocument.Parse(File.ReadAllText(file)) : null;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>models.json entry of a provider (custom providers carry baseUrl/apiKey).</summary>
    private static JsonElement? ModelsProvider(string provider)
    {
        using var models = ReadJson(Path.Combine(AgentDir(), "models.json"));
        if (models is null) return null;
        if (!models.RootElement.TryGetProperty("providers", out var providers) ||
            providers.ValueKind != JsonValueKind.Object) return null;
        if (!providers.TryGetProperty(provider, out var entry) ||
            entry.ValueKind != JsonValueKind.Object) return null;
        return entry.Clone();
    }

    private static string? ConfiguredBaseUrl(string provider)
    {
        var entry = ModelsProvider(provider);
        if (entry is null || !entry.Value.TryGetProperty("baseUrl", out var baseUrl)) return null;
        var raw = baseUrl.GetString();
        return string.IsNullOrWhiteSpace(raw) ? null : raw;
    }

    /// <summary>models.json also allows `$NAME` / `${NAME}` environment interpolation.</summary>
    private static string? ExpandEnv(string value)
    {
        var expanded = EnvPattern.Replace(value, match =>
        {
            var name = match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value;
            return Environment.GetEnvironmentVariable(name) ?? "";
        });
        return string.IsNullOrWhiteSpace(expanded) ? null : expanded;
    }

    /// <summary>Credential: pi's stored api_key first, then the models.json apiKey.
    /// `!command` values are never executed here.</summary>
    public static string? ReadApiKey(string provider)
    {
        using (var auth = ReadJson(Path.Combine(AgentDir(), "auth.json")))
        {
            if (auth is not null &&
                auth.RootElement.TryGetProperty(provider, out var entry) &&
                entry.TryGetProperty("key", out var key) &&
                key.ValueKind == JsonValueKind.String)
            {
                var stored = key.GetString();
                if (!string.IsNullOrEmpty(stored)) return stored;
            }
        }

        var configured = ModelsProvider(provider);
        if (configured is not null &&
            configured.Value.TryGetProperty("apiKey", out var apiKey) &&
            apiKey.ValueKind == JsonValueKind.String)
        {
            var raw = apiKey.GetString();
            if (raw is { Length: > 0 } && !raw.StartsWith("!", StringComparison.Ordinal))
            {
                return ExpandEnv(raw);
            }
        }
        return null;
    }

    /// <summary>Vendor serving the provider's API host (any provider pointing at
    /// one of these hosts gets the same balance treatment).</summary>
    private static bool HostMatches(string host, string suffix) =>
        host.Equals(suffix, StringComparison.OrdinalIgnoreCase) ||
        host.EndsWith("." + suffix, StringComparison.OrdinalIgnoreCase);

    private static Uri? ParseBaseUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return null;
        return uri.Scheme is "http" or "https" ? uri : null;
    }

    public static async Task<ProviderBalance?> FetchProviderBalanceAsync(string provider, string? baseUrl = null)
    {
        // the webview passes the API base URL of the selected model; models.json
        // is the fallback so every host resolves the provider the same way
        var apiBase = ParseBaseUrl(baseUrl) ?? ParseBaseUrl(ConfiguredBaseUrl(provider));
        if (apiBase is null) return null;
        var key = ReadApiKey(provider);
        if (key is null) return null;

        var host = apiBase.Host;
        try
        {
            if (HostMatches(host, "deepseek.com"))
            {
                var payload = await GetAsync($"{apiBase.GetLeftPart(UriPartial.Authority)}/user/balance", key)
                    .ConfigureAwait(false);
                return payload is null ? null : ParseDeepSeekBalance(payload.Value);
            }
            if (HostMatches(host, "openrouter.ai"))
            {
                var payload = await GetAsync($"{apiBase.GetLeftPart(UriPartial.Authority)}/api/v1/credits", key)
                    .ConfigureAwait(false);
                return payload is null ? null : ParseOpenRouterCredits(payload.Value);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            // network/endpoint unreachable: no balance (the UI stays without)
        }
        return null;
    }

    /// <summary>DeepSeek /user/balance payload (mirror of the deepseek vendor
    /// reader in balance.ts): USD preferred, otherwise the first currency.</summary>
    public static ProviderBalance? ParseDeepSeekBalance(JsonElement payload)
    {
        if (!payload.TryGetProperty("balance_infos", out var infos) ||
            infos.ValueKind != JsonValueKind.Array) return null;
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
        if (!chosen.Value.TryGetProperty("currency", out var currency) ||
            !chosen.Value.TryGetProperty("total_balance", out var total)) return null;
        var balance = total.ValueKind == JsonValueKind.Number
            ? total.GetDouble()
            : double.TryParse(total.GetString(), out var parsed) ? parsed : double.NaN;
        if (double.IsNaN(balance) || double.IsInfinity(balance)) return null;
        return new ProviderBalance { Currency = currency.GetString() ?? "USD", Balance = balance };
    }

    /// <summary>OpenRouter /api/v1/credits payload (mirror of the openrouter
    /// vendor reader in balance.ts).</summary>
    public static ProviderBalance? ParseOpenRouterCredits(JsonElement payload)
    {
        if (!payload.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Object) return null;
        var remaining = NumberOrNull(data, "remaining_credits");
        if (remaining is not null)
        {
            return new ProviderBalance { Currency = "USD", Balance = remaining.Value };
        }
        // the endpoint dropped remaining_credits: derive it from credits - usage
        var total = NumberOrNull(data, "total_credits");
        var usage = NumberOrNull(data, "total_usage");
        if (total is null || usage is null) return null;
        return new ProviderBalance { Currency = "USD", Balance = total.Value - usage.Value };
    }

    private static double? NumberOrNull(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number)
        {
            return null;
        }
        var number = value.GetDouble();
        return double.IsNaN(number) || double.IsInfinity(number) ? null : number;
    }

    private static async Task<JsonElement?> GetAsync(string url, string key)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var res = await Http.SendAsync(req).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync().ConfigureAwait(false));
        return doc.RootElement.Clone();
    }

}
