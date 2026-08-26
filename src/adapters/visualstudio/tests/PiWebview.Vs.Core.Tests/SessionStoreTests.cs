// SessionStore tests (mirror of the semantics in tests/sessions.test.ts):
// list with workspace filter, cross-workspace fork, rename/delete, per-session
// CLI flags (the last custom entry wins).

using System.Text.Json;
using PiWebview.Vs.Protocol;
using PiWebview.Vs.Sessions;

namespace PiWebview.Vs.Core.Tests;

public sealed class SessionStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "piw-tests-sessions-" + Guid.NewGuid().ToString("N"));

    public SessionStoreTests() => Directory.CreateDirectory(_dir);

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

    private string WriteSession(string workspace, string fileName, string name = "sess")
    {
        var projDir = Path.Combine(_dir, Encode(workspace));
        Directory.CreateDirectory(projDir);
        var path = Path.Combine(projDir, fileName);
        var header = new Dictionary<string, object?>
        {
            ["type"] = "session",
            ["version"] = 3,
            ["id"] = Guid.NewGuid().ToString(),
            ["timestamp"] = DateTime.UtcNow.ToString("o"),
            ["cwd"] = workspace,
        };
        var msg = new Dictionary<string, object?>
        {
            ["type"] = "message",
            ["timestamp"] = DateTime.UtcNow.ToString("o"),
            ["message"] = new Dictionary<string, object?> { ["role"] = "user", ["content"] = "ciao" },
        };
        var info = new Dictionary<string, object?>
        {
            ["type"] = "session_info",
            ["id"] = Guid.NewGuid().ToString(),
            ["timestamp"] = DateTime.UtcNow.ToString("o"),
            ["name"] = name,
        };
        File.WriteAllLines(path, new[]
        {
            JsonSerializer.Serialize(header),
            JsonSerializer.Serialize(msg),
            JsonSerializer.Serialize(info),
        });
        return path;
    }

    private static string Encode(string workspace) => SessionStore.EncodeProjectFolder(workspace);

    [Fact]
    public void List_sessions_legge_header_nome_e_conteggio()
    {
        var store = new SessionStore();
        var path = WriteSession(@"C:\proj", "sess.jsonl");
        var sessions = store.ListSessions(_dir);
        var s = Assert.Single(sessions);
        Assert.Equal(path, s.Path);
        Assert.Equal(@"C:\proj", s.Cwd);
        Assert.Equal("sess", s.Name);
        Assert.Equal(1, s.MessageCount);
        Assert.Equal("ciao", s.FirstMessage);
        Assert.NotNull(s.LastActivity);
    }

    [Fact]
    public void List_sessions_filtra_per_workspace()
    {
        var store = new SessionStore();
        WriteSession(@"C:\proj-a", "a.jsonl");
        WriteSession(@"C:\proj-b", "b.jsonl");
        Assert.Single(store.ListSessions(_dir, workspace: @"C:\proj-a"));
        Assert.Empty(store.ListSessions(_dir, workspace: @"C:\altrove"));
    }

    [Fact]
    public void Fork_cambia_cwd_e_copia_le_entry()
    {
        var store = new SessionStore();
        var source = WriteSession(@"C:\src", "sess.jsonl");
        var forked = store.ForkSession(source, @"C:\dst", _dir);
        Assert.True(File.Exists(forked.Path));
        var content = File.ReadAllText(forked.Path);
        Assert.Contains("\"cwd\":\"C:\\\\dst\"", content); // JSON: backslashes escaped
        Assert.Contains("parentSession", content);
        // non-header entries copied
        Assert.Contains("\"role\":\"user\"", content);
        // only one header
        Assert.Single(content.Split('\n').Where(l => l.Contains("\"type\":\"session\"")));
    }

    [Fact]
    public void Rename_appende_session_info_e_invalida_la_cache()
    {
        var store = new SessionStore();
        var path = WriteSession(@"C:\proj", "sess.jsonl", "vecchio");
        Assert.Equal("vecchio", store.GetSessionInfo(path).Name);
        store.RenameSessionFile(path, "nuovo nome");
        Assert.Equal("nuovo nome", store.GetSessionInfo(path).Name);
        Assert.Equal(4, File.ReadAllLines(path).Length);
    }

    [Fact]
    public void Delete_rimuove_il_file_idempotente()
    {
        var store = new SessionStore();
        var path = WriteSession(@"C:\proj", "sess.jsonl");
        store.DeleteSessionFile(path);
        Assert.False(File.Exists(path));
        store.DeleteSessionFile(path); // idempotent
    }

    [Fact]
    public void CliFlags_ultima_entry_custom_vince()
    {
        var store = new SessionStore();
        var path = WriteSession(@"C:\proj", "sess.jsonl");
        using var doc = JsonDocument.Parse("{\"sessionControl\":true}");
        var flags1 = new Dictionary<string, JsonElement> { ["sessionControl"] = doc.RootElement.GetProperty("sessionControl").Clone() };
        using var doc2 = JsonDocument.Parse("{\"preset\":\"fast\"}");
        var flags2 = new Dictionary<string, JsonElement> { ["preset"] = doc2.RootElement.GetProperty("preset").Clone() };

        store.WriteSessionCliFlags(path, flags1);
        store.WriteSessionCliFlags(path, flags2);
        var read = store.ReadSessionCliFlags(path);
        Assert.Equal(2, read.Count);
        Assert.True(read["sessionControl"].GetBoolean());
        Assert.Equal("fast", read["preset"].GetString());
    }

    [Fact]
    public void CliFlags_su_file_inesistente_restituisce_vuoto()
    {
        var store = new SessionStore();
        Assert.Empty(store.ReadSessionCliFlags(Path.Combine(_dir, "no.jsonl")));
    }
}
