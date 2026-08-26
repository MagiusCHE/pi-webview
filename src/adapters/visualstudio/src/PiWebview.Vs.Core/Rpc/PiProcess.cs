// Management of the `pi --mode rpc` process — 1:1 C# mirror of
// src/bridge/pi-process.ts (concept 0005 D4): spawn via cmd /c on Windows
// (pi is an npm shim), JSONL with stdin backpressure, restart with backoff
// (max 5, reset after 30s of stability), kill at close.

using System.Diagnostics;
using System.Text.Json;

namespace PiWebview.Vs.Rpc;

public sealed class PiProcessOptions
{
    public IReadOnlyDictionary<string, string>? Env { get; set; }
    public string? Cwd { get; set; }
    public IReadOnlyList<string> Args { get; set; } = Array.Empty<string>();

    /// <summary>Direct spawn node &lt;ScriptPath&gt; --mode rpc … (avoids
    /// cmd /c + .cmd shim which on Windows kills pi's RPC stdin: boot
    /// completes but nothing answers).</summary>
    public string? NodePath { get; set; }
    public string? ScriptPath { get; set; }
}

public sealed class PiProcess : IAsyncDisposable
{
    private readonly string _command; // e.g. C:\...\pi.cmd
    private readonly Action<JsonElement> _onEvent;
    private readonly Action<string>? _onStderr;
    private readonly Action<int?, string?>? _onExit;
    private readonly Action<string>? _log;
    private readonly PiProcessOptions _opts;

    private Process? _proc;
    private JsonlWriter? _writer;
    private CancellationTokenSource? _readCts;
    private volatile bool _stopping;
    private int _restarts;
    private readonly object _gate = new();

    /// <summary>Boot watchdog: if pi emits NO line on stdout within this time
    /// after spawn, the process is probably frozen (e.g. stalled on missing
    /// networks at startup) → kill + restart (cap 5). Never leave the UI
    /// hanging forever in front of a silent pi.</summary>
    private const int BootWatchdogMs = 45_000;
    private volatile bool _booted;
    private Stopwatch? _bootWatch;
    private CancellationTokenSource? _bootCts;

    public PiProcess(
        string command,
        Action<JsonElement> onEvent,
        PiProcessOptions? opts = null,
        Action<string>? onStderr = null,
        Action<int?, string?>? onExit = null,
        Action<string>? log = null)
    {
        _command = command;
        _onEvent = onEvent;
        _opts = opts ?? new PiProcessOptions();
        _onStderr = onStderr;
        _onExit = onExit;
        _log = log;
    }

    public bool Running => _proc is not null;

    public void Start()
    {
        lock (_gate)
        {
            if (_stopping || _proc is not null) return;
            _proc = Spawn();
            _booted = false;
            _bootWatch = Stopwatch.StartNew();
            _bootCts = new CancellationTokenSource();
            _writer = new JsonlWriter(_proc.StandardInput.BaseStream);
            _readCts = new CancellationTokenSource();
            _ = ReadStdoutAsync(_proc, _readCts.Token);
            _ = ReadStderrAsync(_proc);
            _ = WaitExitAsync(_proc);
            _ = ResetStabilityCounterAsync(); // 30s of life → reset the restarts
            _ = WatchdogAsync(_proc, _bootCts.Token);
        }
    }

    private Process Spawn()
    {
        var psi = new ProcessStartInfo
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        List<string> args;
        if (_opts.NodePath is not null && _opts.ScriptPath is not null)
        {
            // Direct spawn: node cli.js --mode rpc … (pi's RpcClient pattern)
            psi.FileName = _opts.NodePath;
            args = new List<string> { _opts.ScriptPath, "--mode", "rpc" };
            args.AddRange(_opts.Args);
        }
        else
        {
            // Fallback (non-Windows or failed resolution): cmd /c shim
            psi.FileName = "cmd.exe";
            args = new List<string> { "/c", _command, "--mode", "rpc" };
            args.AddRange(_opts.Args);
        }
        psi.Arguments = string.Join(" ", args.Select(QuoteWinArg));
        if (_opts.Cwd is not null) psi.WorkingDirectory = _opts.Cwd;
        if (_opts.Env is not null)
        {
            foreach (var pair in _opts.Env) psi.EnvironmentVariables[pair.Key] = pair.Value;
        }
        _log?.Invoke($"spawn: {psi.FileName} {psi.Arguments}");
        return Process.Start(psi)!;
    }

    /// <summary>Quoting for the Windows command line (node/cmd): arguments
    /// with spaces/tabs/quotes are wrapped in "…" and inner quotes doubled.</summary>
    private static string QuoteWinArg(string arg)
    {
        if (arg.Length == 0) return "\"\"";
        if (arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        return "\"" + arg.Replace("\"", "\"\"") + "\"";
    }

    private async Task ReadStdoutAsync(Process proc, CancellationToken ct)
    {
        await JsonlReader.ReadAsync(
            proc.StandardOutput.BaseStream,
            line =>
            {
                MarkBooted();
                var preview = line.Length > 140 ? line.Substring(0, 140) : line;
                _log?.Invoke($"stdout: {preview}");
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    _onEvent(doc.RootElement.Clone());
                }
                catch (JsonException)
                {
                    _log?.Invoke($"non-JSON line from pi, ignored: {preview}");
                }
                catch (Exception ex)
                {
                    // A host/UI delivery failure must not terminate the stdout
                    // pump: pi may already have queued the RPC response.
                    _log?.Invoke($"stdout event handler failed: {ex.Message}");
                }
                return Task.CompletedTask;
            },
            onUnparseable: _ => Task.CompletedTask, // already logged in the catch above
            ct).ConfigureAwait(false);
    }

    private async Task ReadStderrAsync(Process proc)
    {
        try
        {
            using var reader = new StreamReader(proc.StandardError.BaseStream);
            while (true)
            {
                var line = await reader.ReadLineAsync().ConfigureAwait(false);
                if (line is null) return;
                if (!string.IsNullOrWhiteSpace(line)) _onStderr?.Invoke(line);
            }
        }
        catch (IOException)
        {
            // stderr closed
        }
    }

    /// <summary>First line from pi = boot ok: disarms the watchdog.</summary>
    private void MarkBooted()
    {
        if (_booted) return;
        _booted = true;
        _log?.Invoke($"pi boot ok in {_bootWatch?.Elapsed.TotalSeconds:F1}s");
    }

    /// <summary>Boot watchdog: pi frozen (no output for BootWatchdogMs) → kill
    /// the tree; the restart follows WaitExitAsync's normal flow (backoff 1s,
    /// cap 5) and each attempt starts with a new watchdog.</summary>
    private async Task WatchdogAsync(Process proc, CancellationToken ct)
    {
        while (true)
        {
            try
            {
                await Task.Delay(2000, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            if (_booted) return;
            if (_proc != proc || proc.HasExited) return;
            if (_bootWatch is not null && _bootWatch.Elapsed.TotalMilliseconds > BootWatchdogMs)
            {
                _log?.Invoke($"pi unresponsive: no output in the first {BootWatchdogMs / 1000}s of boot — kill + restart");
                KillTree(proc);
                return;
            }
        }
    }

    /// <summary>After 30s of life the process is considered stable: reset the
    /// restart counter (same behavior as the TS timer).</summary>
    private async Task ResetStabilityCounterAsync()
    {
        await Task.Delay(TimeSpan.FromSeconds(30)).ConfigureAwait(false);
        lock (_gate)
        {
            _restarts = 0;
        }
    }

    private async Task WaitExitAsync(Process proc)
    {
        try
        {
            await Task.Run(() => proc.WaitForExit()).ConfigureAwait(false);
        }
        catch (InvalidOperationException)
        {
            // process never really started
        }

        lock (_gate)
        {
            if (_proc != proc) return; // already replaced
            _proc = null;
            _writer = null;
            _readCts?.Cancel();
            _readCts = null;
            _bootCts?.Cancel();
            _bootCts = null;
        }

        if (_stopping) return;

        int restarts;
        lock (_gate)
        {
            restarts = ++_restarts;
        }
        if (restarts > 5)
        {
            _log?.Invoke("pi keeps crashing — stopping");
            _onExit?.Invoke(proc.ExitCode, null);
            return;
        }
        _log?.Invoke($"pi exited (code={proc.ExitCode}); restart in 1s");
        await Task.Delay(1000).ConfigureAwait(false);
        if (_stopping) return;
        Start();
    }

    /// <summary>Queues an RPC payload (UI commands → pi).</summary>
    public void Send(JsonElement payload)
    {
        lock (_gate)
        {
            _log?.Invoke($"send: {payload.GetRawText()}");
            _writer?.Send(payload);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _stopping = true;
        Process? proc;
        lock (_gate)
        {
            proc = _proc;
            _proc = null;
            _readCts?.Cancel();
            _readCts = null;
            _bootCts?.Cancel();
            _bootCts = null;
        }
        if (_writer is not null)
        {
            await _writer.DisposeAsync().ConfigureAwait(false);
            _writer = null;
        }
        try
        {
            if (proc is not null)
            {
                KillTree(proc);
            }
        }
        catch (InvalidOperationException)
        {
            // already exited
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // already exited
        }
    }

    /// <summary>Kill of the whole tree (cmd → node → pi): taskkill /T /F, with
    /// a Kill() fallback when taskkill is unavailable (e.g. sandbox).</summary>
    private static void KillTree(Process proc)
    {
        try
        {
            if (!proc.HasExited)
            {
                using var killer = Process.Start("taskkill.exe", $"/PID {proc.Id} /T /F");
                killer?.WaitForExit(2000);
            }
        }
        catch (Exception)
        {
            // taskkill unavailable: fallback below
        }
        try
        {
            if (!proc.HasExited) proc.Kill();
        }
        catch (InvalidOperationException)
        {
            // already exited
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // already exited
        }
    }
}
