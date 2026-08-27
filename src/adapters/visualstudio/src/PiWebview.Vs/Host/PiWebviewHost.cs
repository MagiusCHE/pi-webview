// Host shared by the tool window instances: spawns `pi --mode rpc`,
// translates the IDE bridge protocol and handles the IDE requests (config,
// sessions, trust, attachments, selection) — C# mirror of
// src/adapters/vscode/host.ts (concept 0005 D4/D5).

using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Threading;
using PiWebview.Vs.Config;
using PiWebview.Vs.Platform;
using PiWebview.Vs.Protocol;
using PiWebview.Vs.Rpc;
using PiWebview.Vs.Sessions;
using Process = System.Diagnostics.Process;

namespace PiWebview.Vs.Host;

public interface IPiHostCallbacks
{
    /// <summary>The webview asks for a new chat in another instance.</summary>
    void OnNewChat();

    /// <summary>Blocking error (pi not found, bash missing): native message.</summary>
    void OnError(string message);

    /// <summary>Non-blocking warning.</summary>
    void OnWarning(string message);

    /// <summary>The webview changed the current session.</summary>
    void OnSessionChange(string path);
}

public sealed class PiWebviewHost : Microsoft.VisualStudio.Threading.IAsyncDisposable
{
    private readonly JoinableTaskFactory _jtf;
    private readonly DTE2 _dte;
    private readonly IPiHostCallbacks _cb;
    private readonly UserConfigStore _config = new();
    private readonly SessionStore _sessions = new();

    private PiProcess? _pi;
    private System.Diagnostics.Stopwatch? _probeWatch;
    private string? _currentSessionPath;
    private bool _restarting;
    private CliFlagInfo[]? _cachedFlags;

    public PiWebviewHost(JoinableTaskFactory jtf, DTE2 dte, IPiHostCallbacks cb)
    {
        _jtf = jtf;
        _dte = dte;
        _cb = cb;
        // host-side localization: the locale is read from the shared user
        // config (same file as the standalone bridge / VS Code companion)
        HostText.CurrentLocale = _config.Get().Locale;
    }

    /// <summary>Output channel to the webview (set by the control).</summary>
    public Action<string>? PostJson { get; set; }

    // --- workspace -------------------------------------------------------------

    public string? Workspace() => _jtf.Run<string?>(async () => WorkspaceSync());

    private string? WorkspaceSync()
    {
        try
        {
            var solution = _dte.Solution;
            if (solution is not null && solution.FullName is { Length: > 0 } full)
            {
                return Path.GetDirectoryName(full);
            }
            var doc = _dte.ActiveDocument;
            if (doc is not null && doc.FullName is { Length: > 0 } docFull)
            {
                return Path.GetDirectoryName(docFull);
            }
        }
        catch (Exception)
        {
            // DTE unavailable: fallback below
        }
        return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    // --- processo pi -----------------------------------------------------------

    public void StartPi(string? sessionPath = null)
    {
        var resolution = PiResolver.ResolvePi();
        Diag.Log($"[pi] resolve: found={resolution.Found} path={resolution.Path}");
        if (!resolution.Found)
        {
            Diag.Log("[pi] not found");
            _cb.OnError(HostText.T(
                "Comando 'pi' non trovato: installa pi con npm install -g @earendil-works/pi-coding-agent",
                "'pi' command not found: install pi with npm install -g @earendil-works/pi-coding-agent"));
            return;
        }
        var bashDir = BashDetector.FindBashDir();

        // a saved session from ANOTHER workspace must be FORKED into the
        // current workspace before resuming (like pi's cross-folder resume)
        if (sessionPath is not null && File.Exists(sessionPath))
        {
            try
            {
                var info = _sessions.GetSessionInfo(sessionPath);
                var ws = Workspace();
                if (info.Cwd is not null && ws is not null && info.Cwd != ws)
                {
                    var forked = _sessions.ForkSession(sessionPath, ws);
                    sessionPath = forked.Path;
                }
            }
            catch (Exception ex)
            {
                _cb.OnWarning(HostText.T(
                    $"pi-webview: impossibile riprendere la sessione nel workspace corrente: {ex.Message}",
                    $"pi-webview: cannot resume the session in the current workspace: {ex.Message}"));
            }
        }

        var sessionArgs = sessionPath is not null && File.Exists(sessionPath)
            ? new[] { "--session", sessionPath }
            : Array.Empty<string>();
        if (sessionArgs.Length > 0) _currentSessionPath = sessionPath;

        var args = sessionArgs.Concat(CliFlagArgs()).ToList();

        var env = new Dictionary<string, string>();
        foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables())
        {
            if (e.Key is string k && e.Value is string v) env[k] = v;
        }
        // marker: the pi-webview extension (pi side) knows it is already integrated
        env["PI_WEBVIEW_COMPANION"] = "1";
        // bash required by pi on Windows: prepend its directory to PATH
        if (bashDir is not null)
        {
            foreach (var key in env.Keys.ToArray())
            {
                if (string.Equals(key, "PATH", StringComparison.OrdinalIgnoreCase))
                {
                    env[key] = bashDir + Path.PathSeparator + env[key];
                    break;
                }
            }
        }
        // Diagnostics: dump of the env passed to pi (the observed freeze was
        // sensitive to the parent process context: the env is the key evidence)
        try
        {
            System.IO.File.WriteAllLines(
                System.IO.Path.Combine(@"C:\Temp", "piwebview-env.txt"),
                env.Select(kv => kv.Key + "=" + kv.Value));
        }
        catch (Exception)
        {
            // diagnostics: never block the startup
        }

        _pi = new PiProcess(
            resolution.Path!,
            onEvent: evt =>
            {
                // ALL events (including extension_ui_request) go TO THE
                // WEBVIEW: the modals appear where the user is looking
                PostFrame("rpc", evt);
                // boot probe: confirms pi really answers (the freeze symptom
                // was boot ok + stdin never read)
                if (evt.ValueKind == JsonValueKind.Object &&
                    evt.TryGetProperty("type", out var t) &&
                    t.GetString() == "response" &&
                    evt.TryGetProperty("id", out var id) &&
                    id.GetString() == "probe-boot")
                {
                    Diag.Log($"probe answered in {_probeWatch?.ElapsedMilliseconds ?? -1}ms");
                }
            },
            opts: new PiProcessOptions
            {
                Env = env,
                Args = args,
                Cwd = Workspace(),
                NodePath = resolution.NodePath,
                ScriptPath = resolution.ScriptPath,
            },
            onStderr: line => Diag.Log("[pi] stderr: " + line),
            onExit: (code, _) =>
            {
                Diag.Log($"[pi] exit code={code}");
                if (_restarting) return; // intentional restart: not a crash
                _cb.OnWarning(HostText.T(
                $"pi è terminato in modo inatteso (code={code})",
                $"pi exited unexpectedly (code={code})"));
                PostRpcEvent(new Dictionary<string, object?> { ["type"] = "connection_closed" });
            },
            log: Diag.Log);
        try
        {
            _pi.Start();
            Diag.Log("[pi] started");
            // Diagnostic probe after boot: end-to-end check of the stdio
            // channel (no answer = pi frozen, not a UI problem)
            _probeWatch = System.Diagnostics.Stopwatch.StartNew();
            _ = ProbePiAsync();
        }
        catch (Exception ex)
        {
            Diag.Log("[pi] start FAILED: " + ex.Message);
            _cb.OnError(HostText.T(
                $"Impossibile avviare pi: {ex.Message}",
                $"Cannot start pi: {ex.Message}"));
        }
    }

    /// <summary>Test get_state 3s after spawn: measures the real RPC channel
    /// latency (freeze diagnosis).</summary>
    private async Task ProbePiAsync()
    {
        await Task.Delay(3000).ConfigureAwait(false);
        if (_pi is null || !_pi.Running) return;
        using var doc = JsonDocument.Parse("{\"type\":\"get_state\",\"id\":\"probe-boot\"}");
        _probeWatch?.Restart();
        _pi.Send(doc.RootElement.Clone());
    }

    public async Task RestartPiAsync()
    {
        var sessionPath = _currentSessionPath;
        _restarting = true;
        if (_pi is not null)
        {
            await _pi.DisposeAsync().ConfigureAwait(false);
            _pi = null;
        }
        PostRpcEvent(new Dictionary<string, object?> { ["type"] = "connection_closed", ["reason"] = "restart" });
        StartPi(sessionPath);
        _restarting = false;
        PostRpcEvent(new Dictionary<string, object?> { ["type"] = "pi_restarted" });
    }

    // --- launch CLI flags (settings block 3) ----------------------------------

    private CliFlags CliFlagValues() => _sessions.ReadSessionCliFlags(_currentSessionPath ?? "");

    private IEnumerable<string> CliFlagArgs()
    {
        foreach (var pair in CliFlagValues())
        {
            var name = pair.Key;
            var value = pair.Value;
            if (value.ValueKind == JsonValueKind.True)
            {
                yield return $"--{name}";
            }
            else if (value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 } s)
            {
                yield return $"--{name}";
                yield return s;
            }
        }
    }

    private async Task<CliFlagInfo[]> FetchAvailableFlagsAsync()
    {
        if (_cachedFlags is not null) return _cachedFlags;
        var resolution = PiResolver.ResolvePi();
        if (!resolution.Found) return Array.Empty<CliFlagInfo>();
        try
        {
            var stdout = await Task.Run(() => ExecHelp(resolution.Path!)).ConfigureAwait(false);
            var clean = Regex.Replace(stdout, "\x1b\\[[0-9;]*m", "");
            var section = clean.Split(new[] { "Extension CLI Flags:" }, StringSplitOptions.None) is { Length: > 1 } parts
                ? parts[1].Split(new[] { "\n\n" }, StringSplitOptions.None)[0]
                : "";
            var flags = new List<CliFlagInfo>();
            foreach (var line in section.Split('\n'))
            {
                var m = Regex.Match(line.Trim(), "^--([a-z0-9-]+)( <value>)?\\s+(.+)$");
                if (!m.Success) continue;
                flags.Add(new CliFlagInfo
                {
                    Name = m.Groups[1].Value,
                    Type = m.Groups[2].Success ? "string" : "boolean",
                    Description = m.Groups[3].Value,
                });
            }
            _cachedFlags = flags.ToArray();
            return _cachedFlags;
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException)
        {
            return Array.Empty<CliFlagInfo>();
        }
    }

    private static string ExecHelp(string piPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            Arguments = "/c " + QuoteCmdArg(piPath) + " --help",
        };
        using var proc = Process.Start(psi)!;
        var stdoutTask = proc.StandardOutput.ReadToEndAsync();
        if (!proc.WaitForExit(15_000))
        {
            try
            {
                proc.Kill();
            }
            catch (InvalidOperationException)
            {
                // already exited
            }
            return "";
        }
        return stdoutTask.GetAwaiter().GetResult();
    }

    private static string QuoteCmdArg(string arg)
    {
        if (arg.Length == 0) return "\"\"";
        if (arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        return "\"" + arg.Replace("\"", "\"\"") + "\"";
    }

    // --- output ----------------------------------------------------------------

    private void PostFrame(string channel, JsonElement payload)
    {
        PostJson?.Invoke(JsonSerializer.Serialize(
            new Dictionary<string, object?> { ["channel"] = channel, ["payload"] = payload },
            ProtocolJson.Options));
    }

    private void PostFrame(string channel, object payload)
    {
        PostJson?.Invoke(JsonSerializer.Serialize(
            new Dictionary<string, object?> { ["channel"] = channel, ["payload"] = payload },
            ProtocolJson.Options));
    }

    private void PostRpcEvent(Dictionary<string, object?> evt)
    {
        PostJson?.Invoke(JsonSerializer.Serialize(
            new Dictionary<string, object?> { ["channel"] = "rpc", ["payload"] = evt },
            ProtocolJson.Options));
    }

    public void PostIdeResponse(IdeResponse res)
    {
        PostJson?.Invoke(JsonSerializer.Serialize(
            new Dictionary<string, object?> { ["channel"] = "ide", ["payload"] = res },
            ProtocolJson.Options));
    }

    /// <summary>IDE event (selection) → webview.</summary>
    public void PostIdeEvent(IdeEvent evt)
    {
        PostJson?.Invoke(JsonSerializer.Serialize(
            new Dictionary<string, object?> { ["channel"] = "ide", ["payload"] = evt },
            ProtocolJson.Options));
    }

    // --- messaggi dalla webview ------------------------------------------------

    public void HandleFrame(Frame frame)
    {
        if (frame.Channel == "rpc")
        {
            Diag.Log("rpc→pi: " + frame.Payload.GetRawText());
            _pi?.Send(frame.Payload);
            return;
        }
        _ = IdeBridge.HandleAsync(this, frame.Payload);
    }

    // --- stato usato da IdeBridge ----------------------------------------------

    public UserConfigStore Config => _config;
    public SessionStore Sessions => _sessions;
    public IPiHostCallbacks Callbacks => _cb;
    public DTE2 Dte => _dte;
    public JoinableTaskFactory Jtf => _jtf;

    public string? CurrentSessionPath
    {
        get => _currentSessionPath;
        set => _currentSessionPath = value;
    }

    public Task<CliFlagInfo[]> AvailableFlagsAsync() => FetchAvailableFlagsAsync();

    /// <summary>Steering queue persisted per workspace (survives restarts).
    /// File: %APPDATA%\pi-webview\steer-queue-<sha1(workspace)>.json</summary>
    public static string SteerQueuePath(string workspace)
    {
        using var sha = System.Security.Cryptography.SHA1.Create();
        var hash = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(workspace));
        var hex = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        return Path.Combine(UserConfigPaths.Dir(), $"steer-queue-{hex}.json");
    }

    public async Task DisposeAsync()
    {
        if (_pi is not null)
        {
            await _pi.DisposeAsync().ConfigureAwait(false);
            _pi = null;
        }
    }
}
