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
                    host.CurrentSessionPath = req.Path;
                    host.Callbacks.OnSessionChange(req.Path);
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
                case "getCliFlags":
                {
                    var available = await host.AvailableFlagsAsync().ConfigureAwait(false);
                    var values = host.Sessions.ReadSessionCliFlags(req.SessionPath ?? host.CurrentSessionPath ?? "");
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
                    host.Sessions.WriteSessionCliFlags(req.SessionPath ?? host.CurrentSessionPath ?? "", req.Flags);
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["flags"] = req.Flags }));
                    await host.RestartPiAsync().ConfigureAwait(false);
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
                case "storeSteerQueue":
                {
                    var items = req.Items?.Select(el =>
                        el.ValueKind == JsonValueKind.Object && el.TryGetProperty("text", out var t)
                            ? new SteerQueueItem { Text = t.GetString() ?? "" }
                            : new SteerQueueItem { Text = el.GetString() ?? "" }).ToList() ?? new List<SteerQueueItem>();
                    var ws = host.Workspace() ?? "";
                    var path = PiWebviewHost.SteerQueuePath(ws);
                    if (items.Count > 0)
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                        File.WriteAllText(path,
                            JsonSerializer.Serialize(new Dictionary<string, object?> { ["items"] = items }, ProtocolJson.Options));
                    }
                    else if (File.Exists(path))
                    {
                        File.Delete(path);
                    }
                    host.PostIdeResponse(Ok(req, null));
                    return;
                }
                case "getSteerQueue":
                {
                    var ws = host.Workspace() ?? "";
                    var path = PiWebviewHost.SteerQueuePath(ws);
                    var items = new List<SteerQueueItem>();
                    try
                    {
                        if (File.Exists(path))
                        {
                            using var doc = JsonDocument.Parse(File.ReadAllText(path));
                            if (doc.RootElement.TryGetProperty("items", out var arr))
                            {
                                items = JsonSerializer.Deserialize<List<SteerQueueItem>>(arr.GetRawText(), ProtocolJson.Options) ?? items;
                            }
                        }
                    }
                    catch (Exception ex) when (ex is IOException or JsonException)
                    {
                        // unreadable queue: empty
                    }
                    host.PostIdeResponse(Ok(req, new Dictionary<string, object?> { ["items"] = items }));
                    return;
                }
                case "getTrust":
                    host.PostIdeResponse(Ok(req, TrustStore.GetTrust(host.Workspace() ?? "")));
                    return;
                case "setTrust":
                    if (req.Status is null) { host.PostIdeResponse(Fail(req, "setTrust: missing status")); return; }
                    host.PostIdeResponse(Ok(req, TrustStore.SetTrust(host.Workspace() ?? "", req.Status)));
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
                        host.Dte.ItemOperations.OpenFile(req.Path);
                        host.PostIdeResponse(Ok(req, null));
                    }
                    catch (Exception ex)
                    {
                        host.PostIdeResponse(Fail(req, ex.Message));
                    }
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
