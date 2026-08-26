// Companion reload signal (concept 0004) — the VS companion reads the signal
// written by the pi extension when the companion is UPDATED while the IDE is
// open. Contract: %USERPROFILE%\.pi\pi-webview\companion-reload.json
// { "version": "x.y.z" }. Comparison semantics: equal → already updated
// (remove, no notification); different → restart notification (VS has no
// window reload).

using System.Text.Json;

namespace PiWebview.Vs.Platform;

public sealed class ReloadSignal
{
    public static string SignalDir() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "pi-webview");

    public static string SignalPath() => Path.Combine(SignalDir(), "companion-reload.json");

    /// <summary>Reads the signal and reacts. Returns the signal version when
    /// a restart is needed (loaded version ≠ signal), otherwise null. The
    /// signal is ALWAYS removed here (no stale signals).</summary>
    public static string? Check(string installedVersion, string? dir = null)
    {
        dir ??= SignalDir();
        var signalPath = Path.Combine(dir, "companion-reload.json");
        try
        {
            if (!File.Exists(signalPath)) return null;
            string? signalVersion = null;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(signalPath));
                if (doc.RootElement.TryGetProperty("version", out var v) &&
                    v.ValueKind == JsonValueKind.String)
                {
                    signalVersion = v.GetString();
                }
            }
            catch (JsonException)
            {
                // corrupted signal: remove without notifying
            }
            File.Delete(signalPath);
            if (signalVersion is null || installedVersion.Length == 0) return null;
            return signalVersion == installedVersion ? null : signalVersion;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null; // best effort: never break activation because of a signal
        }
    }

    /// <summary>Watcher on the signal directory: the update can arrive
    /// while the IDE is open.</summary>
    public static FileSystemWatcher Watch(Action<string> onReloadRequired)
    {
        var watcher = new FileSystemWatcher(SignalDir(), "companion-reload.json")
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
        };
        watcher.Created += (_, _) => onReloadRequired(File.Exists(SignalPath()) ? ReadVersion() : "");
        watcher.Changed += (_, _) => onReloadRequired(File.Exists(SignalPath()) ? ReadVersion() : "");
        try
        {
            Directory.CreateDirectory(SignalDir());
            watcher.EnableRaisingEvents = true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // watcher not active: the activation-time check still covers it
        }
        return watcher;
    }

    private static string ReadVersion()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(SignalPath()));
            return doc.RootElement.TryGetProperty("version", out var v) &&
                   v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? ""
                : "";
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            return "";
        }
    }
}
