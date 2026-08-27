// pi sessions for the header dropdown — 1:1 C# mirror of
// src/bridge/sessions.ts. Sessions live in
// %USERPROFILE%\.pi\agent\sessions\--<workspace>--\*.jsonl; the first record
// is the header {type:"session", id, cwd, name?}. Per-file cache keyed on mtime.

using System.Text.Json;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Sessions;

public sealed class SessionStore
{
    public const string CliFlagsCustomType = "pi-webview-cli-flags";

    private readonly Dictionary<string, (long Mtime, SessionInfo Info)> _cache = new();
    private readonly object _cacheGate = new();

    public string DefaultSessionDir() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".pi", "agent", "sessions");

    public List<SessionInfo> ListSessions(string? dir = null, string? workspace = null)
    {
        dir ??= DefaultSessionDir();
        string[] projectDirs;
        try
        {
            projectDirs = Directory.GetDirectories(dir)
                .Select(Path.GetFileName)
                .OfType<string>()
                .ToArray();
        }
        catch (IOException)
        {
            return new List<SessionInfo>();
        }
        catch (UnauthorizedAccessException)
        {
            return new List<SessionInfo>();
        }

        // Prefer the project folder encoded by pi. Windows path casing and
        // separators can differ between the IDE, the session header, and the
        // folder created from the resolved cwd. If no folder matches, scan
        // the other project folders too and let the header cwd decide below.
        if (workspace is not null)
        {
            var matching = projectDirs
                .Where(d => ProjectFolderMatches(d, workspace))
                .ToArray();
            if (matching.Length > 0) projectDirs = matching;
        }

        var out_ = new List<SessionInfo>();
        foreach (var proj in projectDirs)
        {
            var projPath = Path.Combine(dir, proj);
            string[] files;
            try
            {
                files = Directory.GetFiles(projPath, "*.jsonl");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }
            var decodedWorkspace = DecodeProjectFolder(proj);
            foreach (var f in files)
            {
                var info = CachedSessionInfo(f);
                if (workspace is not null &&
                    !SameWorkspace(info.Cwd, workspace) &&
                    !SameWorkspace(decodedWorkspace, workspace))
                {
                    continue;
                }
                out_.Add(info);
            }
        }

        out_.Sort((a, b) =>
        {
            var ta = a.LastActivity ?? a.Mtime ?? 0;
            var tb = b.LastActivity ?? b.Mtime ?? 0;
            var byTime = tb.CompareTo(ta);
            return byTime != 0 ? byTime : string.Compare(a.Path, b.Path, StringComparison.Ordinal);
        });
        return out_;
    }

    public SessionInfo GetSessionInfo(string path) => CachedSessionInfo(path);

    public void RenameSessionFile(string path, string name)
    {
        var sanitized = name.Replace("\r", " ").Replace("\n", " ").Trim();
        if (sanitized.Length == 0) throw new InvalidOperationException("empty session name");
        if (!path.EndsWith(".jsonl", StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
        {
            throw new InvalidOperationException("session not found");
        }
        var entry = new Dictionary<string, object?>
        {
            ["type"] = "session_info",
            ["id"] = Guid.NewGuid().ToString(),
            ["timestamp"] = DateTime.UtcNow.ToString("o"),
            ["name"] = sanitized,
        };
        File.AppendAllText(path, JsonSerializer.Serialize(entry, ProtocolJson.Options) + "\n");
        lock (_cacheGate) _cache.Remove(path);
    }

    public void DeleteSessionFile(string path)
    {
        if (!path.EndsWith(".jsonl", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("invalid path");
        }
        if (!File.Exists(path)) return; // idempotent
        File.Delete(path);
        lock (_cacheGate) _cache.Remove(path);
    }

    // --- fork (mirror of pi's SessionManager.forkFrom) -------------------------

    public record ForkResult(string Path);

    public ForkResult ForkSession(string sourcePath, string workspace, string? dir = null)
    {
        dir ??= DefaultSessionDir();
        var entries = ReadEntries(sourcePath)
            .Where(e => e is not null)
            .Select(e => e!)
            .ToList();
        var header = entries.FirstOrDefault(e => e.Type == "session");
        if (header.Type is null) throw new InvalidOperationException("invalid source session (no header)");

        var id = Guid.NewGuid().ToString();
        var timestamp = DateTime.UtcNow.ToString("o");
        var newHeader = new Dictionary<string, object?>
        {
            ["type"] = "session",
            ["version"] = header.Version ?? 3,
            ["id"] = id,
            ["timestamp"] = timestamp,
            ["cwd"] = workspace,
            ["parentSession"] = sourcePath,
        };
        var projDir = Path.Combine(dir, EncodeProjectFolder(workspace));
        Directory.CreateDirectory(projDir);
        var fileTimestamp = timestamp.Replace(':', '-').Replace('.', '-');
        var newPath = Path.Combine(projDir, $"{fileTimestamp}_{id}.jsonl");

        using (var stream = new FileStream(newPath, FileMode.CreateNew, FileAccess.Write))
        using (var writer = new StreamWriter(stream))
        {
            writer.Write(JsonSerializer.Serialize(newHeader, ProtocolJson.Options) + "\n");
            foreach (var entry in entries)
            {
                if (entry.Type == "session") continue;
                writer.Write(entry.Raw + "\n");
            }
        }
        return new ForkResult(newPath);
    }

    // --- per-session CLI flags (settings block 3) ------------------------------

    public CliFlags ReadSessionCliFlags(string path)
    {
        var flags = new CliFlags();
        if (path.Length == 0 || !File.Exists(path)) return flags;
        try
        {
            foreach (var entry in ReadEntries(path))
            {
                if (entry is null) continue;
                if (entry.Type == "custom" &&
                    entry.CustomType == CliFlagsCustomType &&
                    entry.Data is JsonElement data &&
                    data.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in data.EnumerateObject())
                    {
                        flags[prop.Name] = prop.Value.Clone();
                    }
                }
            }
        }
        catch (IOException)
        {
            // best effort
        }
        return flags;
    }

    public void WriteSessionCliFlags(string path, Dictionary<string, JsonElement> flags)
    {
        if (path.Length == 0 || !File.Exists(path)) return;
        try
        {
            // parentId = id of the last entry (the current leaf), like
            // pi's appendCustomEntry
            string? parentId = null;
            var lines = File.ReadAllText(path).TrimEnd().Split('\n');
            for (var i = lines.Length - 1; i >= 0; i--)
            {
                var t = lines[i].Trim();
                if (t.Length == 0) continue;
                try
                {
                    using var doc = JsonDocument.Parse(t);
                    if (doc.RootElement.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                    {
                        parentId = id.GetString();
                    }
                }
                catch (JsonException)
                {
                    // unparseable line: keep walking up
                }
                break;
            }
            var entry = new Dictionary<string, object?>
            {
                ["type"] = "custom",
                ["customType"] = CliFlagsCustomType,
                ["data"] = flags,
                ["id"] = Guid.NewGuid().ToString().Substring(0, 8),
                ["timestamp"] = DateTime.UtcNow.ToString("o"),
            };
            if (parentId is not null) entry["parentId"] = parentId;
            File.AppendAllText(path, JsonSerializer.Serialize(entry, ProtocolJson.Options) + "\n");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // best effort: never break Apply because of a failed write
        }
    }

    // --- internals --------------------------------------------------------------

    private sealed record Entry(string? Type, int? Version, string? CustomType, JsonElement? Data, string Raw);

    private static IEnumerable<Entry?> ReadEntries(string path)
    {
        var result = new List<Entry?>();
        var content = File.ReadAllText(path);
        foreach (var raw in content.Split('\n'))
        {
            if (raw.Trim().Length == 0) continue;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                result.Add(new Entry(
                    root.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null,
                    root.TryGetProperty("version", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : null,
                    root.TryGetProperty("customType", out var ct) && ct.ValueKind == JsonValueKind.String ? ct.GetString() : null,
                    root.TryGetProperty("data", out var d) ? d.Clone() : null,
                    raw));
            }
            catch (JsonException)
            {
                result.Add(null);
            }
        }
        return result;
    }

    private SessionInfo CachedSessionInfo(string path)
    {
        long mtime = 0;
        try
        {
            mtime = File.GetLastWriteTimeUtc(path).ToFileTimeUtc();
        }
        catch (IOException)
        {
            // file not reachable
        }
        lock (_cacheGate)
        {
            if (_cache.TryGetValue(path, out var hit) && hit.Mtime == mtime) return hit.Info;
        }
        var info = new SessionInfo { Path = path, Mtime = mtime == 0 ? null : mtime };
        FillSessionInfo(path, info);
        lock (_cacheGate) _cache[path] = (mtime, info);
        return info;
    }

    private static void FillSessionInfo(string path, SessionInfo info)
    {
        string content;
        try
        {
            content = File.ReadAllText(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return;
        }
        var count = 0;
        long? lastActivity = null;
        foreach (var raw in content.Split('\n'))
        {
            if (raw.Trim().Length == 0) continue;
            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(raw);
            }
            catch (JsonException)
            {
                continue;
            }
            using (doc)
            {
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String
                    ? t.GetString()
                    : null;
                if (type == "session")
                {
                    if (root.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                    {
                        info.Id = id.GetString();
                    }
                    if (root.TryGetProperty("cwd", out var cwd) && cwd.ValueKind == JsonValueKind.String)
                    {
                        info.Cwd = cwd.GetString();
                    }
                }
                else if (type == "session_info" &&
                         root.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String)
                {
                    info.Name = name.GetString();
                }
                else if (type == "message")
                {
                    count++;
                    if (root.TryGetProperty("timestamp", out var ts) && ts.ValueKind == JsonValueKind.String &&
                        DateTimeOffset.TryParse(ts.GetString(), out var parsed))
                    {
                        lastActivity = Math.Max(lastActivity ?? 0, parsed.ToUnixTimeMilliseconds());
                    }
                    if (info.FirstMessage is null &&
                        root.TryGetProperty("message", out var m) &&
                        m.TryGetProperty("role", out var role) && role.ValueKind == JsonValueKind.String &&
                        role.GetString() == "user")
                    {
                        var text = UserText(m.TryGetProperty("content", out var c) ? c : default);
                        if (text.Length > 0) info.FirstMessage = text;
                    }
                }
            }
        }
        if (count > 0) info.MessageCount = count;
        if (lastActivity is not null) info.LastActivity = lastActivity;
    }

    private static string UserText(JsonElement content)
    {
        if (content.ValueKind == JsonValueKind.String) return content.GetString()!.Trim();
        if (content.ValueKind == JsonValueKind.Array)
        {
            return string.Join(" ", content.EnumerateArray()
                .Select(b => b.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() ?? "" : "")
                .Where(s => s.Length > 0))
                .Trim();
        }
        return "";
    }

    // Same convention as pi: the folder name encodes the workspace.
    // On Windows separators and ':' become '-' (--C--proj--, like pi's real
    // folders); on Linux it equals replace('/', '-'). The round-trip is not
    // faithful (pi's known limit): matching uses the exact target.
    private static bool IsWindowsWorkspace(string path) =>
        (path.Length >= 3 && char.IsLetter(path[0]) && path[1] == ':' &&
         (path[2] == '\\' || path[2] == '/')) || path.Contains('\\');

    private static string NormalizeWindowsWorkspace(string path) =>
        path.Replace('/', '\\').TrimEnd('\\');

    public static bool SameWorkspace(string? left, string right)
    {
        if (left is null) return false;
        if (string.Equals(left, right, StringComparison.Ordinal)) return true;
        return IsWindowsWorkspace(left) && IsWindowsWorkspace(right) &&
            string.Equals(
                NormalizeWindowsWorkspace(left),
                NormalizeWindowsWorkspace(right),
                StringComparison.OrdinalIgnoreCase);
    }

    private static bool ProjectFolderMatches(string folder, string workspace)
    {
        var target = EncodeProjectFolder(workspace);
        if (string.Equals(folder, target, StringComparison.Ordinal)) return true;
        if (IsWindowsWorkspace(workspace) &&
            string.Equals(folder, target, StringComparison.OrdinalIgnoreCase)) return true;
        return SameWorkspace(DecodeProjectFolder(folder), workspace);
    }

    public static string? DecodeProjectFolder(string name)
    {
        if (!name.StartsWith("--") || !name.EndsWith("--")) return null;
        var inner = name.Substring(2, name.Length - 4);
        if (inner.Length == 0) return null;
        return "/" + inner.Replace('-', '/');
    }

    public static string EncodeProjectFolder(string path)
    {
        var inner = new string(path.Select(ch => ch is '/' or '\\' or ':' ? '-' : ch).ToArray())
            .TrimStart('-');
        return $"--{inner}--";
    }
}
