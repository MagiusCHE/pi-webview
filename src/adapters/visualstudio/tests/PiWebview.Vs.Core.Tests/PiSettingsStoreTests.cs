using System.Text.Json;
using PiWebview.Vs.Config;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Core.Tests;

public sealed class PiSettingsStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "piw-tests-settings-" + Guid.NewGuid().ToString("N"));

    public PiSettingsStoreTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); }
        catch (IOException) { }
    }

    [Fact]
    public void Get_merges_trusted_project_values()
    {
        File.WriteAllText(Path.Combine(_dir, "settings.json"),
            "{\"hideThinkingBlock\":false,\"defaultProvider\":\"openai\",\"defaultModel\":\"global\"}");
        var workspace = Path.Combine(_dir, "workspace");
        Directory.CreateDirectory(Path.Combine(workspace, ".pi"));
        File.WriteAllText(Path.Combine(workspace, ".pi", "settings.json"),
            "{\"hideThinkingBlock\":true,\"defaultModel\":\"project\"}");

        var result = PiSettingsStore.Get(workspace, true, agentDir: _dir);
        var settings = Assert.IsType<List<Dictionary<string, object?>>>(result["settings"]);
        var hidden = Assert.Single(settings, setting => (string)setting["key"]! == "hideThinkingBlock");
        Assert.True(Assert.IsType<JsonElement>(hidden["value"]).GetBoolean());
        var model = Assert.Single(settings, setting => (string)setting["key"]! == "defaultModel");
        var value = Assert.IsType<Dictionary<string, string>>(model["value"]);
        Assert.Equal("openai", value["provider"]);
        Assert.Equal("project", value["id"]);
    }

    [Fact]
    public void Set_writes_a_model_pair_in_one_preserving_merge()
    {
        File.WriteAllText(Path.Combine(_dir, "settings.json"), "{\"keep\":42}");
        using var values = JsonDocument.Parse(
            "{\"model\":{\"provider\":\"deepseek\",\"id\":\"v4\"},\"thinking\":\"high\"}");
        var changes = new List<PiSettingChange>
        {
            new()
            {
                Key = "defaultModel",
                Scope = "global",
                Value = values.RootElement.GetProperty("model").Clone(),
            },
            new()
            {
                Key = "defaultThinkingLevel",
                Scope = "global",
                Value = values.RootElement.GetProperty("thinking").Clone(),
            },
        };

        var result = PiSettingsStore.Set(changes, null, false, _dir);
        Assert.True(result.Ok, result.Error);
        using var written = JsonDocument.Parse(File.ReadAllText(Path.Combine(_dir, "settings.json")));
        Assert.Equal(42, written.RootElement.GetProperty("keep").GetInt32());
        Assert.Equal("deepseek", written.RootElement.GetProperty("defaultProvider").GetString());
        Assert.Equal("v4", written.RootElement.GetProperty("defaultModel").GetString());
        Assert.Equal("high", written.RootElement.GetProperty("defaultThinkingLevel").GetString());
    }
}
