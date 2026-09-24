// BalanceClient tests (mirror of tests/balance.test.ts): the balance endpoint
// follows the API base URL, never the provider id, so any provider pointing at
// a supported API host resolves — custom ids included.

using System.Text.Json;
using PiWebview.Vs.Platform;

namespace PiWebview.Vs.Core.Tests;

public sealed class BalanceClientTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "piw-tests-balance-" + Guid.NewGuid().ToString("N"));

    private readonly string? _previousAgentDir = Environment.GetEnvironmentVariable("PI_AGENT_DIR");

    public BalanceClientTests()
    {
        Directory.CreateDirectory(_dir);
        Environment.SetEnvironmentVariable("PI_AGENT_DIR", _dir);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("PI_AGENT_DIR", _previousAgentDir);
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
            // best effort cleanup
        }
    }

    private void WriteAuth(string json) => File.WriteAllText(Path.Combine(_dir, "auth.json"), json);

    private void WriteModels(string json) => File.WriteAllText(Path.Combine(_dir, "models.json"), json);

    [Fact]
    public void ReadApiKey_prefers_the_stored_credential()
    {
        WriteAuth("""{"any-name":{"type":"api_key","key":"stored-key"}}""");
        Assert.Equal("stored-key", BalanceClient.ReadApiKey("any-name"));
    }

    [Fact]
    public void ReadApiKey_falls_back_to_models_json_with_env_interpolation()
    {
        WriteAuth("{}");
        WriteModels("""{"providers":{"p":{"baseUrl":"https://api.deepseek.com","apiKey":"$PIW_BALANCE_TEST_KEY"}}}""");
        Environment.SetEnvironmentVariable("PIW_BALANCE_TEST_KEY", "key-from-env");
        try
        {
            Assert.Equal("key-from-env", BalanceClient.ReadApiKey("p"));
        }
        finally
        {
            Environment.SetEnvironmentVariable("PIW_BALANCE_TEST_KEY", null);
        }
    }

    [Fact]
    public void ReadApiKey_never_executes_a_command_credential()
    {
        WriteAuth("{}");
        WriteModels("""{"providers":{"p":{"baseUrl":"https://api.deepseek.com","apiKey":"!pass show deepseek"}}}""");
        Assert.Null(BalanceClient.ReadApiKey("p"));
    }

    [Fact]
    public async Task Fetch_returns_null_without_a_key_and_never_calls_the_network()
    {
        WriteAuth("{}");
        WriteModels("""{"providers":{}}""");
        Assert.Null(await BalanceClient.FetchProviderBalanceAsync("no-key", "https://api.deepseek.com"));
        Assert.Null(await BalanceClient.FetchProviderBalanceAsync("no-host"));
    }

    [Fact]
    public async Task Fetch_returns_null_when_the_api_has_no_balance_endpoint()
    {
        // the provider NAME looks like deepseek, the API host does not
        WriteAuth("""{"deepseek-proxy":{"type":"api_key","key":"abc"}}""");
        WriteModels("""{"providers":{"deepseek-proxy":{"baseUrl":"https://api.example.com/v1"}}}""");
        Assert.Null(await BalanceClient.FetchProviderBalanceAsync("deepseek-proxy"));
    }

    [Fact]
    public void OpenRouter_credits_are_derived_from_credits_minus_usage()
    {
        using var payload = JsonDocument.Parse(
            """{"data":{"total_credits":25.5,"total_usage":13.25}}""");
        var balance = BalanceClient.ParseOpenRouterCredits(payload.RootElement);
        Assert.NotNull(balance);
        Assert.Equal("USD", balance!.Currency);
        Assert.Equal(12.25, balance.Balance, 5);
    }

    [Fact]
    public void OpenRouter_remaining_credits_win_when_the_endpoint_provides_them()
    {
        using var payload = JsonDocument.Parse(
            """{"data":{"remaining_credits":4.5,"total_credits":25.5,"total_usage":13.25}}""");
        var balance = BalanceClient.ParseOpenRouterCredits(payload.RootElement);
        Assert.Equal(4.5, balance!.Balance, 5);
    }

    [Fact]
    public void DeepSeek_balance_prefers_usd_and_reads_numeric_strings()
    {
        using var payload = JsonDocument.Parse(
            """{"balance_infos":[{"currency":"CNY","total_balance":"110.00"},{"currency":"USD","total_balance":"36.50"}]}""");
        var balance = BalanceClient.ParseDeepSeekBalance(payload.RootElement);
        Assert.Equal("USD", balance!.Currency);
        Assert.Equal(36.5, balance.Balance, 5);

        using var onlyCny = JsonDocument.Parse(
            """{"balance_infos":[{"currency":"CNY","total_balance":7}]}""");
        var cny = BalanceClient.ParseDeepSeekBalance(onlyCny.RootElement);
        Assert.Equal("CNY", cny!.Currency);
        Assert.Equal(7, cny.Balance, 5);

        using var empty = JsonDocument.Parse("{}");
        Assert.Null(BalanceClient.ParseDeepSeekBalance(empty.RootElement));
    }

    [Fact]
    public void Provider_balance_dto_serializes_currency_and_balance()
    {
        var payload = JsonSerializer.Serialize(
            new PiWebview.Vs.Protocol.ProviderBalance { Currency = "CNY", Balance = 7.5 },
            PiWebview.Vs.Protocol.ProtocolJson.Options);
        Assert.Equal("""{"currency":"CNY","balance":7.5}""", payload);
    }
}
