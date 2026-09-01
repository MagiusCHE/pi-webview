// TrustStore, UserConfigStore, PiResolver, Attachments, ReloadSignal tests
// (semantics mirroring the TS modules in src/bridge/).

using System.Runtime.InteropServices;
using System.Text.Json;
using PiWebview.Vs.Config;
using PiWebview.Vs.Platform;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Core.Tests;

public sealed class TrustStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "piw-tests-trust-" + Guid.NewGuid().ToString("N"));

    public TrustStoreTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
            // best effort
        }
    }

    [Fact]
    public void Default_e_ask()
    {
        var result = TrustStore.GetTrust(@"C:\proj", _dir);
        Assert.Equal("ask", result.Status);
    }

    [Fact]
    public void SetTrusted_persiste_e_vale_per_i_parent()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            // C:\ path semantics (parent walk) are Windows-specific
            return;
        }
        TrustStore.SetTrust(@"C:\proj", "trusted", _dir);
        Assert.Equal("trusted", TrustStore.GetTrust(@"C:\proj", _dir).Status);
        Assert.Equal("trusted", TrustStore.GetTrust(@"C:\proj\sub", _dir).Status);
    }

    [Fact]
    public void Ask_rimuove_la_decisione()
    {
        TrustStore.SetTrust(@"C:\proj", "untrusted", _dir);
        TrustStore.SetTrust(@"C:\proj", "ask", _dir);
        Assert.Equal("ask", TrustStore.GetTrust(@"C:\proj", _dir).Status);
    }

    [Fact]
    public void DefaultProjectTrust_always()
    {
        File.WriteAllText(Path.Combine(_dir, "settings.json"),
            JsonSerializer.Serialize(new Dictionary<string, object?> { ["defaultProjectTrust"] = "always" }));
        Assert.Equal("trusted", TrustStore.GetTrust(@"C:\proj", _dir).Status);
    }
}

public sealed class UserConfigStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "piw-tests-config-" + Guid.NewGuid().ToString("N"));

    public UserConfigStoreTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
            // best effort
        }
    }

    [Fact]
    public void Default_system_e_history_30()
    {
        var store = new UserConfigStore(_dir);
        Assert.Equal("system", store.Get().Theme);
        Assert.Equal(30, store.Get().HistoryLimit);
        Assert.Equal("above", store.Get().StatsBarPosition);
        Assert.Null(store.Get().StatsBarCompact);
    }

    [Fact]
    public void Patch_persiste_sul_disco()
    {
        var store = new UserConfigStore(_dir);
        using var doc = JsonDocument.Parse("""
            {
              "theme": "dark",
              "historyLimit": 50,
              "locale": "en",
              "notifications": "desktop",
              "statsBarPosition": "topbar",
              "statsBarCompact": true,
              "hiddenStatusKeys": ["mcp", "control", "mcp"]
            }
            """);
        var patch = new Dictionary<string, JsonElement>();
        foreach (var p in doc.RootElement.EnumerateObject()) patch[p.Name] = p.Value.Clone();
        store.Patch(patch);

        // re-read from disk (new instance): same values
        var reloaded = new UserConfigStore(_dir).Get();
        Assert.Equal("dark", reloaded.Theme);
        Assert.Equal(50, reloaded.HistoryLimit);
        Assert.Equal("en", reloaded.Locale);
        Assert.Equal("desktop", reloaded.Notifications);
        Assert.Equal("topbar", reloaded.StatsBarPosition);
        Assert.True(reloaded.StatsBarCompact);
        Assert.Equal(new[] { "mcp", "control" }, reloaded.HiddenStatusKeys);
    }

    [Fact]
    public void Patch_ignora_valori_non_validi()
    {
        var store = new UserConfigStore(_dir);
        using var doc = JsonDocument.Parse("""
            {
              "theme": "rosso",
              "historyLimit": 0,
              "statsBarPosition": "left",
              "statsBarCompact": "yes",
              "hiddenStatusKeys": "mcp"
            }
            """);
        var patch = new Dictionary<string, JsonElement>();
        foreach (var p in doc.RootElement.EnumerateObject()) patch[p.Name] = p.Value.Clone();
        store.Patch(patch);
        Assert.Equal("system", store.Get().Theme);
        Assert.Equal(30, store.Get().HistoryLimit);
        Assert.Equal("above", store.Get().StatsBarPosition);
        Assert.Null(store.Get().StatsBarCompact);
        Assert.Null(store.Get().HiddenStatusKeys);
    }
}

public sealed class PiResolverTests
{
    [Fact]
    public void FindOnPath_con_estensioni_windows()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            // pi.cmd / extension probing is Windows-specific
            return;
        }
        var dir = Path.Combine(Path.GetTempPath(), "piw-tests-path-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var file = Path.Combine(dir, "pi.cmd");
            File.WriteAllText(file, "@echo off");
            var found = PiResolver.FindOnPath("pi", dir + Path.PathSeparator + @"C:\inesistente");
            Assert.Equal(file, found);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void FindOnPath_null_se_assente()
    {
        Assert.Null(PiResolver.FindOnPath("pi", @"C:\dir-che-non-esiste-12345"));
    }
}

public sealed class AttachmentsTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "piw-tests-att-" + Guid.NewGuid().ToString("N"));

    public AttachmentsTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
            // best effort
        }
    }

    [Fact]
    public void SaveAttachment_sanifica_e_scrive()
    {
        var result = Attachments.SaveAttachment("../../evil!.txt", "text/plain",
            Convert.ToBase64String("hello"u8.ToArray()), _dir);
        var path = Assert.IsType<string>(result["path"]);
        Assert.Equal("hello", File.ReadAllText(path));
        Assert.DoesNotContain("..", path);
        Assert.Equal("text/plain", result["mimeType"]);
    }

    [Fact]
    public void PathExists_file_e_cartella()
    {
        var file = Path.Combine(_dir, "a.txt");
        File.WriteAllText(file, "x");
        Assert.True(Attachments.PathExists(file));
        Assert.True(Attachments.PathExists(_dir));
        Assert.False(Attachments.PathExists(Path.Combine(_dir, "no.txt")));
    }
}

public sealed class ReloadSignalTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "piw-tests-reload-" + Guid.NewGuid().ToString("N"));

    public ReloadSignalTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
            // best effort
        }
    }

    private string Signal() => Path.Combine(_dir, "companion-reload.json");

    private void WriteSignal(string version) =>
        File.WriteAllText(Signal(), JsonSerializer.Serialize(new Dictionary<string, object?> { ["version"] = version }));

    [Fact]
    public void Versioni_uguali_nessuna_notifica_e_segnale_rimosso()
    {
        WriteSignal("0.1.0");
        Assert.Null(ReloadSignal.Check("0.1.0", _dir));
        Assert.False(File.Exists(Signal()));
    }

    [Fact]
    public void Versioni_diverse_notifica_e_rimozione()
    {
        WriteSignal("0.2.0");
        Assert.Equal("0.2.0", ReloadSignal.Check("0.1.0", _dir));
        Assert.False(File.Exists(Signal()));
    }

    [Fact]
    public void Segnale_assente_null()
    {
        Assert.Null(ReloadSignal.Check("0.1.0", _dir));
    }
}
