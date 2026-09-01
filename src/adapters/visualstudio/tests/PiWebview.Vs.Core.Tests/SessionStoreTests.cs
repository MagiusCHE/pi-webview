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
        var messageId = Guid.NewGuid().ToString();
        var msg = new Dictionary<string, object?>
        {
            ["type"] = "message",
            ["id"] = messageId,
            ["timestamp"] = DateTime.UtcNow.ToString("o"),
            ["message"] = new Dictionary<string, object?> { ["role"] = "user", ["content"] = "ciao" },
        };
        var info = new Dictionary<string, object?>
        {
            ["type"] = "session_info",
            ["id"] = Guid.NewGuid().ToString(),
            ["parentId"] = messageId,
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
    public void Session_info_espone_ultimo_evento_e_numero_compattazioni()
    {
        var store = new SessionStore();
        var path = WriteSession(@"C:\proj", "sess.jsonl");
        File.AppendAllLines(path, new[]
        {
            JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["type"] = "compaction",
                ["id"] = "compaction-1",
                ["timestamp"] = "2026-08-27T20:00:00.000Z",
                ["summary"] = "first",
            }),
            JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["type"] = "compaction",
                ["id"] = "compaction-2",
                ["timestamp"] = "2026-08-27T20:05:00.000Z",
                ["summary"] = "second",
            }),
            JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["type"] = "session_info",
                ["id"] = "last-event",
                ["timestamp"] = "2026-08-27T20:10:11.000Z",
                ["name"] = "renamed",
            }),
        });

        var info = store.GetSessionInfo(path);
        Assert.Equal(2, info.CompactionCount);
        Assert.Equal(
            DateTimeOffset.Parse("2026-08-27T20:10:11.000Z").ToUnixTimeMilliseconds(),
            info.LastEventAt);
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
    public void List_sessions_windows_ignora_case_e_stile_separatori()
    {
        var store = new SessionStore();
        WriteSession(@"c:\work\pi-webview", "sess.jsonl");
        var session = Assert.Single(store.ListSessions(_dir, workspace: "C:/Work/pi-webview"));
        Assert.Equal(@"c:\work\pi-webview", session.Cwd);
    }

    [Fact]
    public void List_sessions_usa_cwd_header_se_cartella_codificata_differisce()
    {
        var store = new SessionStore();
        var path = WriteSession(@"C:\Work\pi-webview", "sess.jsonl");
        var originalDir = Path.GetDirectoryName(path)!;
        var legacyDir = Path.Combine(_dir, "--legacy-project-folder--");
        Directory.Move(originalDir, legacyDir);

        var session = Assert.Single(store.ListSessions(_dir, workspace: @"C:\Work\pi-webview"));
        Assert.Equal("sess.jsonl", Path.GetFileName(session.Path));
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
        Assert.Single(content.Split('\n'), l => l.Contains("\"type\":\"session\""));
    }

    [Fact]
    public void Rename_appende_session_info_e_invalida_la_cache()
    {
        var store = new SessionStore();
        var path = WriteSession(@"C:\proj", "sess.jsonl", "vecchio");
        Assert.Equal("vecchio", store.GetSessionInfo(path).Name);
        using var previousDoc = JsonDocument.Parse(File.ReadAllLines(path).Last());
        var previous = previousDoc.RootElement.GetProperty("id").GetString();
        store.RenameSessionFile(path, "nuovo nome");
        Assert.Equal("nuovo nome", store.GetSessionInfo(path).Name);
        var lines = File.ReadAllLines(path);
        Assert.Equal(4, lines.Length);
        using var appended = JsonDocument.Parse(lines.Last());
        Assert.Equal(previous, appended.RootElement.GetProperty("parentId").GetString());
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

    [Fact]
    public void SameWorkspace_windows_case_insensitive_e_separatori()
    {
        Assert.True(SessionStore.SameWorkspace(@"C:\Users\Magius\proj", @"c:\users\magius\PROJ"));
        Assert.True(SessionStore.SameWorkspace(@"C:/Users/magius/proj", @"C:\Users\magius\proj"));
        Assert.True(SessionStore.SameWorkspace(@"C:\Users\magius\proj\", @"C:\Users\magius\proj"));
        Assert.False(SessionStore.SameWorkspace(@"C:\Users\a\proj", @"C:\Users\b\proj"));
        Assert.False(SessionStore.SameWorkspace(null, @"C:\proj"));
        Assert.False(SessionStore.SameWorkspace("/home/x/proj", "/home/X/proj"));
    }
}
