// pi.dev settings facade for the Visual Studio host. This mirrors
// src/bridge/pi-settings.ts: schema-driven reads, trusted project overrides,
// validated batch writes, and the lock path used by pi's SettingsManager.

using System.Text.Json;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Config;

public static class PiSettingsStore
{
    private static readonly string[] ThinkingLevels =
    {
        "off", "minimal", "low", "medium", "high", "xhigh", "max",
    };

    public static Dictionary<string, object?> Get(
        string? workspace,
        bool workspaceTrusted,
        string? key = null,
        string? agentDir = null)
    {
        var global = Read(GlobalPath(agentDir));
        var project = workspaceTrusted && workspace is not null
            ? Read(ProjectPath(workspace))
            : new Dictionary<string, JsonElement>();
        var settings = Definitions()
            .Where(setting => key is null || (string)setting["key"]! == key)
            .Select(setting =>
            {
                var copy = new Dictionary<string, object?>(setting);
                var settingKey = (string)setting["key"]!;
                if (settingKey == "defaultModel")
                {
                    var provider = Effective(project, global, "defaultProvider");
                    var model = Effective(project, global, "defaultModel");
                    if (provider?.ValueKind == JsonValueKind.String &&
                        model?.ValueKind == JsonValueKind.String)
                    {
                        copy["value"] = new Dictionary<string, string>
                        {
                            ["provider"] = provider.Value.GetString()!,
                            ["id"] = model.Value.GetString()!,
                        };
                    }
                }
                else if ((string)setting["source"]! == "pi-settings-file")
                {
                    var value = Effective(project, global, settingKey);
                    if (value.HasValue) copy["value"] = value.Value;
                }
                return copy;
            })
            .ToList();
        return new Dictionary<string, object?>
        {
            ["settings"] = settings,
            ["workspace"] = workspace,
            ["workspaceTrusted"] = workspace is null ? null : workspaceTrusted,
        };
    }

    public static (bool Ok, string? Error) Set(
        IReadOnlyList<PiSettingChange> changes,
        string? workspace,
        bool workspaceTrusted,
        string? agentDir = null)
    {
        var writes = new Dictionary<string, Dictionary<string, JsonElement>>(
            StringComparer.OrdinalIgnoreCase);
        foreach (var change in changes)
        {
            var validation = Validate(change);
            if (validation is not null) return (false, validation);
            var scope = change.Scope ?? (workspaceTrusted && workspace is not null ? "project" : "global");
            if (scope == "project" && (workspace is null || !workspaceTrusted))
            {
                return (false, "workspace not trusted: project overrides are disabled");
            }
            var path = scope == "project" ? ProjectPath(workspace!) : GlobalPath(agentDir);
            if (!writes.TryGetValue(path, out var patch))
            {
                patch = new Dictionary<string, JsonElement>();
                writes[path] = patch;
            }
            if (change.Key == "defaultModel")
            {
                patch["defaultProvider"] = change.Value.GetProperty("provider").Clone();
                patch["defaultModel"] = change.Value.GetProperty("id").Clone();
            }
            else
            {
                patch[change.Key] = change.Value.Clone();
            }
        }

        try
        {
            foreach (var write in writes)
            {
                WithLock(write.Key, () =>
                {
                    var current = Read(write.Key);
                    foreach (var pair in write.Value) current[pair.Key] = pair.Value;
                    WriteAtomic(write.Key, current);
                });
            }
            return (true, null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return (false, ex.Message);
        }
    }

    private static string? Validate(PiSettingChange change)
    {
        switch (change.Key)
        {
            case "defaultModel":
                if (change.Value.ValueKind != JsonValueKind.Object ||
                    !change.Value.TryGetProperty("provider", out var provider) ||
                    provider.ValueKind != JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(provider.GetString()) ||
                    !change.Value.TryGetProperty("id", out var model) ||
                    model.ValueKind != JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(model.GetString()))
                {
                    return "defaultModel: expected model { provider, id }";
                }
                return null;
            case "defaultThinkingLevel":
                return change.Value.ValueKind == JsonValueKind.String &&
                       ThinkingLevels.Contains(change.Value.GetString() ?? "")
                    ? null
                    : "defaultThinkingLevel: invalid value";
            case "hideThinkingBlock":
                return change.Value.ValueKind is JsonValueKind.True or JsonValueKind.False
                    ? null
                    : "hideThinkingBlock: expected boolean";
            default:
                return $"unknown file-backed setting: {change.Key}";
        }
    }

    private static List<Dictionary<string, object?>> Definitions() => new()
    {
        Setting("defaultModel", "piSettingDefaultModel", "model", "pi-settings-file", "both",
            description: "piSettingDefaultModelDesc", group: "piSettingsGroupNewSessions", propagation: "restart"),
        Setting("defaultThinkingLevel", "piSettingDefaultThinkingLevel", "enum", "pi-settings-file", "both",
            description: "piSettingDefaultThinkingLevelDesc", group: "piSettingsGroupNewSessions",
            propagation: "restart", options: Options(ThinkingLevels)),
        Setting("hideThinkingBlock", "piSettingHideThinkingBlock", "boolean", "pi-settings-file", "both",
            description: "piSettingHideThinkingBlockDesc", propagation: "restart"),
        Setting("steeringMode", "piSettingSteeringMode", "enum", "pi-rpc", "session",
            options: ModeOptions()),
        Setting("followUpMode", "piSettingFollowUpMode", "enum", "pi-rpc", "session",
            options: ModeOptions()),
        Setting("autoCompaction", "piSettingAutoCompaction", "boolean", "pi-rpc", "session"),
    };

    private static Dictionary<string, object?> Setting(
        string key,
        string label,
        string type,
        string source,
        string scope,
        string? description = null,
        string? group = null,
        string? propagation = null,
        object? options = null)
    {
        var setting = new Dictionary<string, object?>
        {
            ["key"] = key,
            ["label"] = label,
            ["type"] = type,
            ["writable"] = true,
            ["source"] = source,
            ["scope"] = scope,
        };
        if (description is not null) setting["description"] = description;
        if (group is not null) setting["group"] = group;
        if (propagation is not null) setting["propagation"] = propagation;
        if (options is not null) setting["options"] = options;
        return setting;
    }

    private static List<Dictionary<string, string>> Options(IEnumerable<string> values) =>
        values.Select(value => new Dictionary<string, string>
        {
            ["value"] = value,
            ["label"] = value switch
            {
                "off" => "levelOff",
                "minimal" => "levelMinimal",
                "low" => "levelLow",
                "medium" => "levelMedium",
                "high" => "levelHigh",
                "xhigh" => "levelXHigh",
                "max" => "levelMax",
                _ => value,
            },
        }).ToList();

    private static List<Dictionary<string, string>> ModeOptions() => new()
    {
        new() { ["value"] = "one-at-a-time", ["label"] = "piSettingModeOptOneAtATime" },
        new() { ["value"] = "all", ["label"] = "piSettingModeOptAll" },
    };

    private static JsonElement? Effective(
        Dictionary<string, JsonElement> project,
        Dictionary<string, JsonElement> global,
        string key) => project.TryGetValue(key, out var projectValue)
        ? projectValue
        : global.TryGetValue(key, out var globalValue) ? globalValue : null;

    private static string AgentDir() => Environment.GetEnvironmentVariable("PI_AGENT_DIR") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent");

    private static string GlobalPath(string? agentDir = null) =>
        Path.Combine(agentDir ?? AgentDir(), "settings.json");

    private static string ProjectPath(string workspace) =>
        Path.Combine(workspace, ".pi", "settings.json");

    private static Dictionary<string, JsonElement> Read(string path)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                       File.ReadAllText(path), ProtocolJson.Options) ?? new();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return new Dictionary<string, JsonElement>();
        }
    }

    private static void WithLock(string path, Action action)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var lockPath = path + ".lock";
        var acquired = false;
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var candidate = lockPath + "." + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(candidate);
            try
            {
                // Moving a private candidate directory into the canonical lock
                // path is atomic and fails when pi or another host owns it.
                Directory.Move(candidate, lockPath);
                acquired = true;
                break;
            }
            catch (IOException) when (attempt < 9)
            {
                Directory.Delete(candidate, recursive: true);
                Thread.Sleep(20);
            }
            catch
            {
                Directory.Delete(candidate, recursive: true);
                throw;
            }
        }
        if (!acquired) throw new IOException("failed to acquire settings lock");
        try
        {
            action();
        }
        finally
        {
            try { Directory.Delete(lockPath, recursive: true); } catch (IOException) { }
        }
    }

    private static void WriteAtomic(string path, Dictionary<string, JsonElement> value)
    {
        var temp = path + "." + System.Diagnostics.Process.GetCurrentProcess().Id + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(value, ProtocolJson.Options) + "\n");
        if (File.Exists(path)) File.Replace(temp, path, null);
        else File.Move(temp, path);
    }
}
