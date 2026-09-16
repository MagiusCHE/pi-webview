// Routing of IdeRequest → native VS implementations — C# mirror of the
// switch in src/adapters/vscode/host.ts (concept 0005 D3). Unsupported
// requests answer with a clear error (same behavior as the VS Code companion:
// the dialogs are done by the web UI).

using System.Reflection;
using System.Text.Json;
using EnvDTE;
using PiWebview.Vs.Config;
using PiWebview.Vs.Platform;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Host;

public static class IdeBridge
{
    public static async Task HandleAsync(PiWebviewHost host, JsonElement payload)
    {
        var req = IdeRequest.FromJson(payload);
        if (req is null)
        {
            host.PostIdeResponse(new IdeResponse { Ok = false, Error = "unparseable IDE request" });
            return;
        }
        try
        {
            switch (req.Type)
            {
                case "getConfig":
                    host.PostIdeResponse(Ok(req, host.Config.Get()));
                    return;
                case "setConfig":
                    if (req.Patch is null)
                    {
                        host.PostIdeResponse(Fail(req, "setConfig: missing patch"));
                        return;
                    }
                    host.PostIdeResponse(Ok(req, host.Config.Patch(req.Patch)));
                    return;
                case "storeSession":
                    if (req.Path is null) { host.PostIdeResponse(Fail(req, "storeSession: missing path")); return; }
                    host.StoreSession(req.Path);
                    host.PostIdeResponse(Ok(req, null));
                    return;
                case "openNewChat":
                    host.Callbacks.OnNewChat();
                    host.PostIdeResponse(Ok(req, null));
                    return;
                case "getBalance":
                    if (req.Provider is null) { host.PostIdeResponse(Fail(req, "getBalance: missing provider")); return; }
                    host.PostIdeResponse(Ok(req, await BalanceClient.FetchProviderBalanceAsync(req.Provider).ConfigureAwait(false)));
                    return;
                case "getCompactionSettings":
                    host.PostIdeResponse(Ok(req, CompactionSettingsReader.Read()));
                    return;
                case "getThinkingSettings":
                    host.PostIdeResponse(Ok(req, PiThinkingSettingsReader.Read(host.Workspace())));
                    return;
                case "getSettings":
                {
                    var workspace = host.Workspace();
                    var trusted = host.Trust.IsTrusted();
                    host.PostIdeResponse(Ok(req,
                        PiSettingsStore.Get(workspace, trusted, req.Key)));
                    return;
                }
                case "applySettings":
                {
                    var changes = req.Settings is JsonElement settings &&
                        settings.ValueKind == JsonValueKind.Array
                        ? JsonSerializer.Deserialize<List<PiSettingChange>>(
                            settings.GetRawText(), ProtocolJson.Options)
                        : new List<PiSettingChange>();
                    if (changes is null)
                    {
                        host.PostIdeResponse(Fail(req, "applySettings: invalid settings"));
                        return;
                    }
                    if (changes.Count > 0)
                    {
                        var workspace = host.Workspace();
                        var trusted = host.Trust.IsTrusted();
                        var result = PiSettingsStore.Set(changes, workspace, trusted);
                        if (!result.Ok)
                        {
                            host.PostIdeResponse(Fail(req, result.Error ?? "apply_settings failed"));
                            return;
                        }
                    }
                    host.PostIdeResponse(Ok(req,
                        new Dictionary<string, object?> { ["needsRestart"] = true }));
                    if (req.Flags is not null)
                    {
                        await host.ApplyCliFlagsAsync(req.SessionPath, req.Flags).ConfigureAwait(false);
                    }
                    else
                    {
                        await host.RestartPiAsync().ConfigureAwait(false);
                    }
                    return;
                }
                case "setSetting":
                case "setSettings":
                {
                    List<PiSettingChange>? changes;
                    if (req.Type == "setSettings")
                    {
                        changes = req.Settings is JsonElement settings &&
                            settings.ValueKind == JsonValueKind.Array
                            ? JsonSerializer.Deserialize<List<PiSettingChange>>(
                                settings.GetRawText(), ProtocolJson.Options)
                            : null;
                    }
                    else
                    {
                        changes = req.Key is not null && req.Value.HasValue
                            ? new List<PiSettingChange>
                            {
                                new()
                                {
                                    Key = req.Key,
                                    Value = req.Value.Value,
                                    Scope = req.Scope,
                                },
                            }
                            : null;
                    }
                    if (changes is null)
                    {
                        host.PostIdeResponse(Fail(req, "set_settings: missing settings"));
                        return;
                    }
                    var workspace = host.Workspace();
                    var trusted = host.Trust.IsTrusted();
                    var result = PiSettingsStore.Set(changes, workspace, trusted);
                    if (!result.Ok)
                    {
                        host.PostIdeResponse(Fail(req, result.Error ?? "set_settings failed"));
                        return;
                    }
                    host.PostIdeResponse(Ok(req,
                        new Dictionary<string, object?> { ["needsRestart"] = true }));
                    await host.RestartPiAsync().ConfigureAwait(false);
                    return;
                }
                case "listSessions":
                {
                    var ws = host.Workspace();
                    host.PostIdeResponse(Ok(req, new SessionListResult
                    {
                        Sessions = await Task.Run(() =>
                            host.Sessions.ListSessions(workspace: req.Workspace ?? ws)).ConfigureAwait(false),
                        Workspace = ws,
                    }));
                    return;
                }
                case "getWorkspace":
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["workspace"] = host.Workspace() }));
                    return;
                case "getVersion":
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?>
                    {
                        ["source"] = "visualstudio",
                        ["version"] = VersionLabel(),
                    }));
                    return;
                case "getSessionSettings":
                    if (req.SessionPath is null) { host.PostIdeResponse(Fail(req, "getSessionSettings: missing sessionPath")); return; }
                    host.PostIdeResponse(Ok(req, host.Sessions.ReadSessionSettings(req.SessionPath)));
                    return;
                case "setSessionSettings":
                {
                    if (req.SessionPath is null) { host.PostIdeResponse(Fail(req, "setSessionSettings: missing sessionPath")); return; }
                    if (req.Settings is not JsonElement settings || settings.ValueKind != JsonValueKind.Object)
                    {
                        host.PostIdeResponse(Fail(req, "setSessionSettings: missing settings"));
                        return;
                    }
                    var sessionSettings = JsonSerializer.Deserialize<SessionSettings>(
                        settings.GetRawText(), ProtocolJson.Options) ?? new SessionSettings();
                    host.Sessions.WriteSessionSettings(req.SessionPath, sessionSettings);
                    host.PostIdeResponse(Ok(req, null));
                    return;
                }
                case "getCliFlags":
                {
                    var available = await host.AvailableFlagsAsync().ConfigureAwait(false);
                    var values = host.CliFlagValues(req.SessionPath);
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?>
                    {
                        ["available"] = available,
                        ["values"] = values,
                    }));
                    return;
                }
                case "setCliFlags":
                {
                    if (req.Flags is null) { host.PostIdeResponse(Fail(req, "setCliFlags: missing flags")); return; }
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["flags"] = req.Flags }));
                    await host.ApplyCliFlagsAsync(req.SessionPath, req.Flags).ConfigureAwait(false);
                    return;
                }
                case "forkSession":
                {
                    var ws = host.Workspace();
                    if (ws is null) { host.PostIdeResponse(Fail(req, "no open workspace")); return; }
                    if (req.SourcePath is null) { host.PostIdeResponse(Fail(req, "forkSession: missing sourcePath")); return; }
                    var forked = host.Sessions.ForkSession(req.SourcePath, ws);
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["path"] = forked.Path }));
                    return;
                }
                case "getSessionInfo":
                    if (req.Path is null) { host.PostIdeResponse(Fail(req, "getSessionInfo: missing path")); return; }
                    host.PostIdeResponse(Ok(req, host.Sessions.GetSessionInfo(req.Path)));
                    return;
                case "renameSession":
                    if (req.Path is null || req.Name is null) { host.PostIdeResponse(Fail(req, "renameSession: missing path/name")); return; }
                    host.Sessions.RenameSessionFile(req.Path, req.Name);
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["path"] = req.Path, ["name"] = req.Name }));
                    return;
                case "deleteSession":
                    if (req.Path is null) { host.PostIdeResponse(Fail(req, "deleteSession: missing path")); return; }
                    host.Sessions.DeleteSessionFile(req.Path);
                    host.PostIdeResponse(Ok(req, null));
                    return;
                case "getTrust":
                    host.PostIdeResponse(Ok(req, host.Trust.Result(host.Workspace() ?? "")));
                    return;
                case "applyTrustOption":
                    if (req.Option is null) { host.PostIdeResponse(Fail(req, "applyTrustOption: missing option")); return; }
                    try
                    {
                        host.PostIdeResponse(Ok(req, host.Trust.Apply(host.Workspace() ?? "", req.Option)));
                    }
                    catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException)
                    {
                        host.PostIdeResponse(Fail(req, $"trust option failed: {ex.Message}"));
                    }
                    return;
                case "saveAttachment":
                    if (req.Name is null || req.DataBase64 is null) { host.PostIdeResponse(Fail(req, "saveAttachment: missing fields")); return; }
                    host.PostIdeResponse(Ok(req, Attachments.SaveAttachment(req.Name, req.MimeType ?? "", req.DataBase64)));
                    return;
                case "pathExists":
                    if (req.Path is null) { host.PostIdeResponse(Fail(req, "pathExists: missing path")); return; }
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["exists"] = Attachments.PathExists(req.Path) }));
                    return;
                case "attachSelection":
                    // the selection arrives anyway via continuous broadcast
                    // (SelectionTracker → all webviews)
                    host.PostIdeResponse(Ok(req, null));
                    return;
                case "openFile":
                    if (req.Path is null) { host.PostIdeResponse(Fail(req, "openFile: missing path")); return; }
                    await host.Jtf.SwitchToMainThreadAsync();
                    try
                    {
                        var filePath = req.Path;
                        var workspace = host.Workspace();
                        if (!System.IO.Path.IsPathRooted(filePath) && !string.IsNullOrWhiteSpace(workspace))
                            filePath = System.IO.Path.GetFullPath(System.IO.Path.Combine(workspace, filePath));
                        host.Dte.ItemOperations.OpenFile(filePath);
                        host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["path"] = filePath }));
                    }
                    catch (Exception ex)
                    {
                        host.PostIdeResponse(Fail(req, ex.Message));
                    }
                    return;
                case "getStartupInfo":
                {
                    // new-session welcome banner + header update shield: a
                    // per-pi-process file written by the pi-side extension
                    // (never part of the session jsonl). Passed through as-is
                    // (tolerant: absent/malformed file → info null).
                    var pid = host.PiPid;
                    JsonElement? info = null;
                    if (pid is not null)
                    {
                        var file = Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                            ".pi", "pi-webview", $"startup-info-{pid}.json");
                        try
                        {
                            using var doc = JsonDocument.Parse(File.ReadAllText(file));
                            var root = doc.RootElement;
                            if (root.ValueKind == JsonValueKind.Object &&
                                root.TryGetProperty("contextFiles", out var contextFiles) && contextFiles.ValueKind == JsonValueKind.Array &&
                                root.TryGetProperty("skills", out var skills) && skills.ValueKind == JsonValueKind.Array &&
                                root.TryGetProperty("extensions", out var extensions) && extensions.ValueKind == JsonValueKind.Array)
                            {
                                info = root.Clone();
                            }
                        }
                        catch
                        {
                            // missing or malformed file → info stays null
                        }
                    }
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["info"] = info ?? null }));
                    return;
                }
                case "restartPi":
                    // restart the pi process with the current session (same
                    // path as setCliFlags "Applica"): the webview gets
                    // connection_closed(restart) + pi_restarted and
                    // re-initializes transparently.
                    host.PostIdeResponse(Ok(req, null));
                    await host.RestartPiAsync().ConfigureAwait(false);
                    return;
                case "reloadWebview":
                    // host-driven webview reload: the control re-navigates the
                    // WebView2 (folder-mapped, re-served from disk). The pi
                    // process survives; the fresh page re-initializes from pi's
                    // live state (same contract as the VS Code companion).
                    host.PostIdeResponse(Ok(req, null));
                    host.OnReloadWebview?.Invoke();
                    return;
                case "clipboardWrite":
                    if (req.Text is null) { host.PostIdeResponse(Fail(req, "clipboardWrite: missing text")); return; }
                    await host.Jtf.SwitchToMainThreadAsync();
                    try
                    {
                        System.Windows.Clipboard.SetText(req.Text);
                        host.PostIdeResponse(Ok(req, null));
                    }
                    catch (Exception ex)
                    {
                        host.PostIdeResponse(Fail(req, ex.Message));
                    }
                    return;
                default:
                    host.PostIdeResponse(Fail(req, $"unsupported IDE request: {req.Type}"));
                    return;
            }
        }
        catch (Exception ex)
        {
            host.PostIdeResponse(Fail(req, ex.Message));
        }
    }

    // Version shown in the settings dialog: the assembly informational version
    // (set from the package version at build time via -p:VsixVersion, e.g.
    // "0.2.3"), not the 4-part AssemblyVersion ("0.2.3.0") — the same version
    // reported by the VS Code companion and piw.
    private static string? VersionLabel()
    {
        var info = typeof(IdeBridge).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;
        if (string.IsNullOrEmpty(info)) return null;
        // net472: no range operator (System.Range/System.Index are not available)
        var plus = info!.IndexOf('+');
        return plus >= 0 ? info.Substring(0, plus) : info;
    }

    private static IdeResponse Ok(IdeRequest req, object? data) => new()
    {
        Id = req.Id ?? "",
        Ok = true,
        Data = data,
    };

    private static IdeResponse Fail(IdeRequest req, string error) => new()
    {
        Id = req.Id ?? "",
        Ok = false,
        Error = error,
    };
}
