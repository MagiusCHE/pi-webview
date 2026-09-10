// Project trust, like pi.dev — C# mirror of src/bridge/trust.ts:
// ~/.pi/agent/trust.json (path → bool map) + defaultProjectTrust in
// ~/.pi/agent/settings.json ("ask" | "always" | "never").
//
// pi never prompts in RPC mode, so with no saved decision and default "ask"
// the protected project resources are ignored for that run: the effective
// status is a boolean (no third "ask" level). The "this session only" options
// of the prompt persist nothing and use the per-run --approve/--no-approve.

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
        var status = decision is not null
            ? decision.Value ? "trusted" : "untrusted"
            : defaultTrust == "always" ? "trusted" : "untrusted";
        return new TrustResult
        {
            Status = status,
            Workspace = workspace,
            ParentPath = ParentPath(workspace),
            Options = Options(workspace),
        };
    }

    /// <summary>The folder the "trust parent folder" option saves its decision to.</summary>
    public static string? ParentPath(string workspace)
    {
        var parent = Path.GetDirectoryName(workspace);
        return string.IsNullOrEmpty(parent) || parent == workspace ? null : parent;
    }

    /// <summary>Options of the pi trust prompt (same list and order as pi core).</summary>
    public static List<TrustOption> Options(string workspace)
    {
        var options = new List<TrustOption> { new() { Id = "trust" } };
        if (ParentPath(workspace) is not null)
        {
            options.Add(new TrustOption { Id = "trust-parent" });
        }
        options.Add(new TrustOption { Id = "trust-session", SessionOverride = true });
        options.Add(new TrustOption { Id = "untrust" });
        options.Add(new TrustOption { Id = "untrust-session", SessionOverride = false });
        return options;
    }

    /// <summary>Run-only pi flags of the session-only options.</summary>
    public static IEnumerable<string> OverrideArgs(bool? sessionOverride)
    {
        if (sessionOverride is null) return Array.Empty<string>();
        return new[] { sessionOverride.Value ? "--approve" : "--no-approve" };
    }

    /// <summary>
    /// Applies one option of the prompt: persisted ones write trust.json, the
    /// session-only ones only report the per-run override to use at launch.
    /// </summary>
    public static TrustApplyResult ApplyOption(string workspace, string optionId, string? dir = null)
    {
        dir ??= TrustDir();
        var option = Options(workspace).FirstOrDefault(o => o.Id == optionId)
                     ?? throw new ArgumentException($"unknown trust option: {optionId}");
        if (option.SessionOverride is null)
        {
            WriteUpdates(workspace, optionId, dir);
            return new TrustApplyResult { Status = GetTrust(workspace, dir).Status };
        }
        return new TrustApplyResult
        {
            Status = option.SessionOverride.Value ? "trusted" : "untrusted",
            SessionOverride = option.SessionOverride,
        };
    }

    private static void WriteUpdates(string workspace, string optionId, string dir)
    {
        var updates = new List<(string Path, bool? Decision)>();
        switch (optionId)
        {
            case "trust":
                updates.Add((workspace, true));
                break;
            case "trust-parent":
            {
                var parent = ParentPath(workspace);
                if (parent is not null)
                {
                    updates.Add((parent, true));
                    updates.Add((workspace, null)); // no folder-specific decision
                }
                break;
            }
            case "untrust":
                updates.Add((workspace, false));
                break;
        }
        if (updates.Count == 0) return;

        var path = Path.Combine(dir, "trust.json");
        var trustFile = ReadJson(path);
        var obj = trustFile.HasValue
            ? JsonSerializer.Deserialize<Dictionary<string, object?>>(trustFile.Value.GetRawText()) ?? new Dictionary<string, object?>()
            : new Dictionary<string, object?>();
        foreach (var (entry, decision) in updates)
        {
            if (decision is null) obj.Remove(entry);
            else obj[entry] = decision.Value;
        }
        // A silent failure would leave the UI showing a decision that was never
        // saved: the error must reach the caller (shown in the webview chat).
        Directory.CreateDirectory(dir);
        File.WriteAllText(path,
            JsonSerializer.Serialize(obj, new JsonSerializerOptions { WriteIndented = true }) + "\n");
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

/// <summary>Result of applying one trust option: the status pi applies after
/// the next restart, plus the run-only override for session-only options.</summary>
public sealed class TrustApplyResult
{
    public string Status { get; set; } = "untrusted";
    public bool? SessionOverride { get; set; }
}
