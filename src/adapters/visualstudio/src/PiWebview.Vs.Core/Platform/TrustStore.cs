// Trust level of the current project, like pi.dev — C# mirror of
// src/bridge/trust.ts: ~/.pi/agent/trust.json (path → bool map) +
// defaultProjectTrust in ~/.pi/agent/settings.json ("ask"|"always"|"never").

using System.Text.Json;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Platform;

public static class TrustStore
{
    public static string TrustDir() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent");

    public static TrustResult GetTrust(string workspace, string? dir = null)
    {
        dir ??= TrustDir();
        var trustFile = ReadJson(Path.Combine(dir, "trust.json"));
        var settings = ReadJson(Path.Combine(dir, "settings.json"));

        string? defaultTrust = null;
        if (settings.HasValue &&
            settings.Value.TryGetProperty("defaultProjectTrust", out var dt) &&
            dt.ValueKind == JsonValueKind.String)
        {
            defaultTrust = dt.GetString();
        }

        var decision = trustFile.HasValue ? FindTrust(trustFile.Value, workspace) : (bool?)null;
        string status;
        if (decision is not null)
        {
            status = decision.Value ? "trusted" : "untrusted";
        }
        else if (defaultTrust == "always")
        {
            status = "trusted";
        }
        else if (defaultTrust == "never")
        {
            status = "untrusted";
        }
        else
        {
            status = "ask";
        }
        return new TrustResult { Status = status, Workspace = workspace };
    }

    public static TrustResult SetTrust(string workspace, string status, string? dir = null)
    {
        dir ??= TrustDir();
        var path = Path.Combine(dir, "trust.json");
        var trustFile = ReadJson(path);
        var obj = trustFile.HasValue
            ? JsonSerializer.Deserialize<Dictionary<string, object?>>(trustFile.Value.GetRawText()) ?? new Dictionary<string, object?>()
            : new Dictionary<string, object?>();

        if (status == "ask")
        {
            obj.Remove(workspace);
        }
        else
        {
            obj[workspace] = status == "trusted";
        }
        try
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(path,
                JsonSerializer.Serialize(obj, new JsonSerializerOptions { WriteIndented = true }) + "\n");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // directory not writable: report the requested status anyway
        }
        return GetTrust(workspace, dir);
    }

    private static JsonElement? ReadJson(string path)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.Clone();
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    // the decision applies to the folder or a parent (like pi)
    private static bool? FindTrust(JsonElement trustFile, string workspace)
    {
        var current = workspace;
        for (;;)
        {
            if (trustFile.TryGetProperty(current, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                return v.ValueKind == JsonValueKind.True;
            }
            var parent = Path.GetDirectoryName(current);
            if (parent is null || parent == current) return null;
            current = parent;
        }
    }
}
