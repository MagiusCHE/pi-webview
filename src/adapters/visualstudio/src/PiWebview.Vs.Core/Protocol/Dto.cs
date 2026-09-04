// IDE bridge protocol DTOs (concept 0005 D3) — C# mirror of
// src/ide/protocol.ts. Identical wire format (camelCase): the host does not
// know the semantics of RPC messages (JsonElement passthrough), it only
// types the "ide" channel it must implement.
//
// TS↔C# drift mitigation: the fixtures in <repo>/tests/fixtures/ide-protocol/
// are deserialized both by the TS tests and by PiWebview.Vs.Core.Tests.

using System.Text.Json;

namespace PiWebview.Vs.Protocol;

/// <summary>Container of every UI ↔ host message (protocol.ts: Frame).</summary>
public sealed record Frame(string Channel, JsonElement Payload)
{
    public static Frame? Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("channel", out var ch) ||
                ch.ValueKind != JsonValueKind.String) return null;
            if (!root.TryGetProperty("payload", out var payload)) return null;
            return new Frame(ch.GetString()!, payload.Clone());
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>UI → host request (protocol.ts: IdeRequest).
/// The optional fields cover ALL contract types; unused ones stay null.
/// Unknown payloads end up in ExtensionData.</summary>
public sealed class IdeRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("id")]
    public string? Id { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("path")]
    public string? Path { get; set; }

    // showQuickPick: string[] — storeSteerQueue: SteerQueueItem[] → JsonElement
    // and per-request-type deserialization (same JSON name "items")
    [System.Text.Json.Serialization.JsonPropertyName("items")]
    public List<JsonElement>? Items { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("title")]
    public string? Title { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("placeholder")]
    public string? Placeholder { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("message")]
    public string? Message { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("kind")]
    public string? Kind { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("text")]
    public string? Text { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("workspace")]
    public string? Workspace { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("provider")]
    public string? Provider { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("patch")]
    public Dictionary<string, JsonElement>? Patch { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("flags")]
    public Dictionary<string, JsonElement>? Flags { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("key")]
    public string? Key { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("value")]
    public JsonElement? Value { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("scope")]
    public string? Scope { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("settings")]
    public List<PiSettingChange>? Settings { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("action")]
    public string? Action { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("sessionPath")]
    public string? SessionPath { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("sourcePath")]
    public string? SourcePath { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string? Name { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("mimeType")]
    public string? MimeType { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("dataBase64")]
    public string? DataBase64 { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("status")]
    public string? Status { get; set; }

    public static IdeRequest? FromJson(JsonElement payload)
    {
        try
        {
            return JsonSerializer.Deserialize<IdeRequest>(payload.GetRawText(), ProtocolJson.Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>Host → UI response (protocol.ts: IdeResponse).</summary>
public sealed class IdeResponse
{
    [System.Text.Json.Serialization.JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("data")]
    public object? Data { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("error")]
    public string? Error { get; set; }
}

/// <summary>Host → UI event (protocol.ts: IdeEvent).</summary>
public abstract class IdeEvent
{
    [System.Text.Json.Serialization.JsonPropertyName("type")]
    public string Type { get; set; } = "";

    public sealed class SelectionChanged : IdeEvent
    {
        public SelectionChanged() => Type = "selection_changed";

        [System.Text.Json.Serialization.JsonPropertyName("filePath")]
        public string? FilePath { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("workspaceFolder")]
        public string? WorkspaceFolder { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("ranges")]
        public List<SelectionRange>? Ranges { get; set; }
    }

    public sealed class SelectionCleared : IdeEvent
    {
        public SelectionCleared() => Type = "selection_cleared";

        [System.Text.Json.Serialization.JsonPropertyName("reason")]
        public string? Reason { get; set; }
    }

    public sealed class AtMentioned : IdeEvent
    {
        public AtMentioned() => Type = "at_mentioned";

        [System.Text.Json.Serialization.JsonPropertyName("filePath")]
        public string? FilePath { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("rangeText")]
        public string? RangeText { get; set; }
    }
}

public sealed class SelectionRange
{
    [System.Text.Json.Serialization.JsonPropertyName("text")]
    public string Text { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("selection")]
    public LineRange Selection { get; set; } = new();
}

public sealed class LineRange
{
    [System.Text.Json.Serialization.JsonPropertyName("start")]
    public Position Start { get; set; } = new();

    [System.Text.Json.Serialization.JsonPropertyName("end")]
    public Position End { get; set; } = new();
}

public sealed class Position
{
    [System.Text.Json.Serialization.JsonPropertyName("line")]
    public int Line { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("character")]
    public int Character { get; set; }
}

/// <summary>Shared user config (D7 of concept 0002).</summary>
public sealed class UserConfig
{
    [System.Text.Json.Serialization.JsonPropertyName("theme")]
    public string Theme { get; set; } = "system";

    [System.Text.Json.Serialization.JsonPropertyName("locale")]
    public string? Locale { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("historyLimit")]
    public int? HistoryLimit { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("notifications")]
    public string? Notifications { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("statsBarPosition")]
    public string? StatsBarPosition { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("statsBarCompact")]
    public bool? StatsBarCompact { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("hiddenStatusKeys")]
    public List<string>? HiddenStatusKeys { get; set; }
}

/// <summary>pi CLI flags (settings block 3): name → value.</summary>
public sealed class CliFlags : Dictionary<string, JsonElement>
{
}

public sealed class CliFlagInfo
{
    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("type")]
    public string Type { get; set; } = "boolean";

    [System.Text.Json.Serialization.JsonPropertyName("description")]
    public string? Description { get; set; }
}

public sealed class PiSettingChange
{
    [System.Text.Json.Serialization.JsonPropertyName("key")]
    public string Key { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("value")]
    public JsonElement Value { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("scope")]
    public string? Scope { get; set; }
}

public sealed class SessionModel
{
    [System.Text.Json.Serialization.JsonPropertyName("provider")]
    public string Provider { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("id")]
    public string Id { get; set; } = "";
}

public sealed class SessionInfo
{
    [System.Text.Json.Serialization.JsonPropertyName("path")]
    public string Path { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("id")]
    public string? Id { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("cwd")]
    public string? Cwd { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string? Name { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("model")]
    public SessionModel? Model { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("firstMessage")]
    public string? FirstMessage { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("messageCount")]
    public int? MessageCount { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("lastActivity")]
    public long? LastActivity { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("lastEventAt")]
    public long? LastEventAt { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("compactionCount")]
    public int? CompactionCount { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("sizeBytes")]
    public long? SizeBytes { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("mtime")]
    public long? Mtime { get; set; }
}

public sealed class SessionListResult
{
    [System.Text.Json.Serialization.JsonPropertyName("sessions")]
    public List<SessionInfo> Sessions { get; set; } = new();

    [System.Text.Json.Serialization.JsonPropertyName("workspace")]
    public string? Workspace { get; set; }
}

public sealed class CompactionSettings
{
    [System.Text.Json.Serialization.JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("reserveTokens")]
    public int ReserveTokens { get; set; } = 16384;

    [System.Text.Json.Serialization.JsonPropertyName("keepRecentTokens")]
    public int KeepRecentTokens { get; set; } = 20000;
}

public sealed class ThinkingSettings
{
    [System.Text.Json.Serialization.JsonPropertyName("hideThinkingBlock")]
    public bool HideThinkingBlock { get; set; }
}

public sealed class SteerQueueItem
{
    [System.Text.Json.Serialization.JsonPropertyName("text")]
    public string Text { get; set; } = "";
}

public sealed class TrustResult
{
    [System.Text.Json.Serialization.JsonPropertyName("status")]
    public string Status { get; set; } = "ask";

    [System.Text.Json.Serialization.JsonPropertyName("workspace")]
    public string Workspace { get; set; } = "";
}

public sealed class ProviderBalance
{
    [System.Text.Json.Serialization.JsonPropertyName("currency")]
    public string Currency { get; set; } = "USD";

    [System.Text.Json.Serialization.JsonPropertyName("balance")]
    public double Balance { get; set; }
}

/// <summary>Protocol JSON options: camelCase everywhere.</summary>
public static class ProtocolJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = null, // dictionary keys (e.g. CliFlags) unchanged
    };
}
