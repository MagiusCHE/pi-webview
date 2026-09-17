// User config shared with the standalone bridge (concept 0005 D7):
// Windows → %APPDATA%\pi-webview\config.json — the SAME file used by
// src/bridge/config.ts. Atomic write (tmp + rename).

using System.Text.Json;
using PiWebview.Vs.Platform;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Config;

public static class UserConfigPaths
{
    public static string Dir()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appData, "pi-webview");
    }

    public static string FilePath() => Path.Combine(Dir(), "config.json");
}

public sealed class UserConfigStore
{
    public static readonly UserConfig Default = new()
    {
        Theme = "system",
        HistoryLimit = 30,
        StatsBarPosition = "above",
        AgenticThinking = false,
        AllowRemoteNpmUpdates = false,
        DangerouslyAllowAllNpmScripts = false,
        SpeechToText = DefaultSpeechToText(),
    };

    private static SpeechToTextConfig DefaultSpeechToText() => new()
    {
        Mode = "push-to-talk",
        Language = "system",
        AllowCloudTranscription = false,
        ToggleSilenceMs = 1500,
        Shortcuts = new Dictionary<string, string>
        {
            ["pushToTalk"] = "Ctrl+Alt+Space",
            ["toggleToTalk"] = "Ctrl+Alt+M",
        },
        InputByRuntime = new Dictionary<string, string>(),
    };

    private UserConfig _config;

    public UserConfigStore(string? dir = null)
    {
        Dir = dir ?? UserConfigPaths.Dir();
        _config = Read();
    }

    public string Dir { get; }

    private string ConfigPath() => Path.Combine(Dir, "config.json");

    private UserConfig Read()
    {
        try
        {
            var raw = File.ReadAllText(ConfigPath());
            var parsed = JsonSerializer.Deserialize<UserConfig>(raw, ProtocolJson.Options);
            if (parsed is null) return Clone(Default);
            return new UserConfig
            {
                Theme = parsed.Theme ?? Default.Theme,
                Locale = parsed.Locale,
                HistoryLimit = parsed.HistoryLimit ?? Default.HistoryLimit,
                Notifications = parsed.Notifications,
                StatsBarPosition = parsed.StatsBarPosition ?? Default.StatsBarPosition,
                StatsBarCompact = parsed.StatsBarCompact,
                AgenticThinking = parsed.AgenticThinking,
                AllowRemoteNpmUpdates = parsed.AllowRemoteNpmUpdates,
                DangerouslyAllowAllNpmScripts = parsed.DangerouslyAllowAllNpmScripts,
                BrowserToolPermissions = CloneBrowserPermissions(parsed.BrowserToolPermissions),
                HiddenStatusKeys = parsed.HiddenStatusKeys?
                    .Where(key => !string.IsNullOrWhiteSpace(key))
                    .Distinct(StringComparer.Ordinal)
                    .ToList(),
                SpeechToText = CloneSpeechToText(parsed.SpeechToText),
            };
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return Clone(Default);
        }
    }

    public UserConfig Get() => Clone(_config);

    public UserConfig Patch(Dictionary<string, JsonElement> patch)
    {
        if (patch.TryGetValue("theme", out var theme) && theme.ValueKind == JsonValueKind.String)
        {
            var v = theme.GetString();
            if (v is "light" or "dark" or "system") _config.Theme = v;
        }
        if (patch.TryGetValue("locale", out var locale))
        {
            _config.Locale = locale.ValueKind == JsonValueKind.Null ? null : locale.GetString();
        }
        if (patch.TryGetValue("historyLimit", out var limit) &&
            limit.ValueKind == JsonValueKind.Number && limit.TryGetInt32(out var n) && n >= 1)
        {
            _config.HistoryLimit = n;
        }
        if (patch.TryGetValue("notifications", out var notifications) &&
            notifications.ValueKind == JsonValueKind.String)
        {
            var v = notifications.GetString();
            if (v is "desktop" or "vscode" or "off") _config.Notifications = v;
        }
        if (patch.TryGetValue("statsBarPosition", out var position) &&
            position.ValueKind == JsonValueKind.String)
        {
            var v = position.GetString();
            if (v is "above" or "below" or "topbar") _config.StatsBarPosition = v;
        }
        if (patch.TryGetValue("statsBarCompact", out var compact) &&
            compact.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            _config.StatsBarCompact = compact.GetBoolean();
        }
        if (patch.TryGetValue("agenticThinking", out var agenticThinking) &&
            agenticThinking.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            _config.AgenticThinking = agenticThinking.GetBoolean();
        }
        if (patch.TryGetValue("allowRemoteNpmUpdates", out var allowRemoteNpmUpdates) &&
            allowRemoteNpmUpdates.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            _config.AllowRemoteNpmUpdates = allowRemoteNpmUpdates.GetBoolean();
        }
        if (patch.TryGetValue("dangerouslyAllowAllNpmScripts", out var allowAllNpmScripts) &&
            allowAllNpmScripts.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            _config.DangerouslyAllowAllNpmScripts = allowAllNpmScripts.GetBoolean();
        }
        if (patch.TryGetValue("browserToolPermissions", out var browserPermissions) &&
            browserPermissions.ValueKind == JsonValueKind.Object)
        {
            _config.BrowserToolPermissions = JsonSerializer.Deserialize<BrowserPersistentPermissions>(
                browserPermissions.GetRawText(), ProtocolJson.Options);
        }
        if (patch.TryGetValue("hiddenStatusKeys", out var hidden) &&
            hidden.ValueKind == JsonValueKind.Array)
        {
            _config.HiddenStatusKeys = hidden.EnumerateArray()
                .Where(value => value.ValueKind == JsonValueKind.String)
                .Select(value => value.GetString())
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value!)
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }
        if (patch.TryGetValue("speechToText", out var speech) &&
            speech.ValueKind == JsonValueKind.Object)
        {
            try
            {
                _config.SpeechToText = NormalizeSpeechToText(
                    JsonSerializer.Deserialize<SpeechToTextConfig>(speech.GetRawText(), ProtocolJson.Options));
            }
            catch (JsonException)
            {
                // Keep the current valid preferences when an untyped bridge patch is malformed.
            }
        }
        Write();
        return Get();
    }

    private void Write()
    {
        Directory.CreateDirectory(Dir);
        var tmp = ConfigPath() + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_config, new JsonSerializerOptions { WriteIndented = true }) + "\n");
        if (File.Exists(ConfigPath())) File.Delete(ConfigPath()); // File.Move does not overwrite in netstandard2.0
        File.Move(tmp, ConfigPath());
    }

    private static UserConfig Clone(UserConfig c) => new()
    {
        Theme = c.Theme,
        Locale = c.Locale,
        HistoryLimit = c.HistoryLimit,
        Notifications = c.Notifications,
        StatsBarPosition = c.StatsBarPosition,
        StatsBarCompact = c.StatsBarCompact,
        AgenticThinking = c.AgenticThinking,
        AllowRemoteNpmUpdates = c.AllowRemoteNpmUpdates,
        DangerouslyAllowAllNpmScripts = c.DangerouslyAllowAllNpmScripts,
        BrowserToolPermissions = CloneBrowserPermissions(c.BrowserToolPermissions),
        HiddenStatusKeys = c.HiddenStatusKeys is null ? null : new List<string>(c.HiddenStatusKeys),
        SpeechToText = CloneSpeechToText(c.SpeechToText),
    };

    private static SpeechToTextConfig CloneSpeechToText(SpeechToTextConfig? config) =>
        NormalizeSpeechToText(config);

    private static SpeechToTextConfig NormalizeSpeechToText(SpeechToTextConfig? config)
    {
        var defaults = DefaultSpeechToText();
        if (config is null) return defaults;
        var mode = config.Mode == "toggle-to-talk" ? "toggle-to-talk" : "push-to-talk";
        var language = string.IsNullOrWhiteSpace(config.Language) ? "system" : config.Language.Trim();
        var silence = Math.Max(500, Math.Min(10000, config.ToggleSilenceMs));
        var shortcuts = new Dictionary<string, string>(defaults.Shortcuts!, StringComparer.Ordinal);
        if (config.Shortcuts is not null)
        {
            foreach (var key in new[] { "pushToTalk", "toggleToTalk" })
            {
                if (config.Shortcuts.TryGetValue(key, out var value) &&
                    TryNormalizeShortcut(value, out var shortcut))
                {
                    shortcuts[key] = shortcut;
                }
            }
        }
        var devices = new Dictionary<string, string>(StringComparer.Ordinal);
        if (config.InputByRuntime is not null)
        {
            foreach (var entry in config.InputByRuntime)
            {
                var deviceId = entry.Value;
                if (entry.Key.Length == 0 || entry.Key.Length > 256 || deviceId is null ||
                    string.IsNullOrWhiteSpace(deviceId) || deviceId.Length > 1024) continue;
                devices[entry.Key] = deviceId;
            }
        }
        return new SpeechToTextConfig
        {
            Mode = mode,
            Language = language,
            AllowCloudTranscription = config.AllowCloudTranscription,
            ToggleSilenceMs = silence,
            Shortcuts = shortcuts,
            InputByRuntime = devices,
        };
    }

    private static bool TryNormalizeShortcut(string? value, out string shortcut)
    {
        shortcut = "";
        if (value is null || string.IsNullOrWhiteSpace(value) || value.Length > 100) return false;
        var parts = value.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Trim())
            .Where(part => part.Length > 0)
            .ToArray();
        if (parts.Length < 2) return false;
        var modifierOrder = new[] { "Ctrl", "Alt", "Shift", "Meta" };
        var modifiers = new HashSet<string>(StringComparer.Ordinal);
        string? code = null;
        foreach (var part in parts)
        {
            var modifier = modifierOrder.FirstOrDefault(candidate =>
                string.Equals(candidate, part, StringComparison.OrdinalIgnoreCase));
            if (modifier is not null)
            {
                if (!modifiers.Add(modifier)) return false;
            }
            else if (code is null)
            {
                code = part;
            }
            else
            {
                return false;
            }
        }
        if (code is null || modifiers.Count == 0) return false;
        var orderedParts = modifierOrder.Where(modifiers.Contains).ToList();
        orderedParts.Add(code);
        shortcut = string.Join("+", orderedParts);
        return true;
    }

    private static BrowserPersistentPermissions? CloneBrowserPermissions(
        BrowserPersistentPermissions? permissions) => permissions is null
        ? null
        : new BrowserPersistentPermissions
        {
            Global = permissions.Global is null ? null : new List<string>(permissions.Global),
            Sites = permissions.Sites?.ToDictionary(
                entry => entry.Key,
                entry => entry.Value is null
                    ? new List<string>()
                    : new List<string>(entry.Value),
                StringComparer.Ordinal),
        };
}

/// <summary>Mirrors pi's SettingsManager.getHideThinkingBlock(): global
/// settings first, then the trusted project override.</summary>
public static class PiThinkingSettingsReader
{
    public static ThinkingSettings Read(string? workspace, string? agentDir = null)
    {
        agentDir ??= Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent");
        var hide = ReadValue(Path.Combine(agentDir, "settings.json")) ?? false;
        if (workspace is { Length: > 0 } &&
            TrustStore.GetTrust(workspace, agentDir).Status == "trusted")
        {
            hide = ReadValue(Path.Combine(workspace, ".pi", "settings.json")) ?? hide;
        }
        return new ThinkingSettings { HideThinkingBlock = hide };
    }

    private static bool? ReadValue(string path)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.TryGetProperty("hideThinkingBlock", out var value) &&
                   value.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? value.GetBoolean()
                : null;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}

/// <summary>Compaction section of pi's config (~/.pi/config.json) —
/// mirror of readCompactionSettings() in src/bridge/config.ts.</summary>
public static class CompactionSettingsReader
{
    public static CompactionSettings Read()
    {
        var defaults = new CompactionSettings();
        try
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var raw = File.ReadAllText(Path.Combine(home, ".pi", "config.json"));
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("compaction", out var c)) return defaults;
            return new CompactionSettings
            {
                Enabled = c.TryGetProperty("enabled", out var e) && e.ValueKind == JsonValueKind.True ||
                          (!c.TryGetProperty("enabled", out _) && defaults.Enabled),
                ReserveTokens = GetInt(c, "reserveTokens") ?? defaults.ReserveTokens,
                KeepRecentTokens = GetInt(c, "keepRecentTokens") ?? defaults.KeepRecentTokens,
            };
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return defaults;
        }
    }

    private static int? GetInt(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)
            ? n
            : null;
}
