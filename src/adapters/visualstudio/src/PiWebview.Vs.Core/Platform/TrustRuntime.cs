// Per-process project trust of the Visual Studio host — C# mirror of the
// TrustRuntime class in src/bridge/trust.ts.
//
// The running pi process keeps the decision it was launched with, so a change
// is only applied by a restart. The "this session only" options of the pi TUI
// prompt are never persisted: they launch pi with the per-run override flags
// `--approve` / `--no-approve`, consumed by the NEXT launch and forgotten by
// the one after.

using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Platform;

public sealed class TrustRuntime
{
    private readonly string _dir;
    private string _workspace;
    private bool? _pendingOverride;
    private bool? _appliedOverride;
    private string _launchStatus;
    private bool _restartPending;

    public TrustRuntime(string workspace, string? dir = null)
    {
        _dir = dir ?? TrustStore.TrustDir();
        _workspace = workspace;
        _launchStatus = TrustStore.GetTrust(workspace, _dir).Status;
    }

    public void SetWorkspace(string workspace)
    {
        _workspace = workspace;
        _launchStatus = TrustStore.GetTrust(workspace, _dir).Status;
    }

    /// <summary>Flags for the pi process about to be launched.</summary>
    public IEnumerable<string> LaunchArgs() => TrustStore.OverrideArgs(_pendingOverride);

    /// <summary>Called right after pi was (re)launched: the pending change is live.</summary>
    public void OnLaunched()
    {
        var over = _pendingOverride;
        _launchStatus = over is null
            ? TrustStore.GetTrust(_workspace, _dir).Status
            : over.Value ? "trusted" : "untrusted";
        _appliedOverride = over;
        _pendingOverride = null;
        _restartPending = false;
    }

    /// <summary>Status the running pi process was launched with.</summary>
    public string Status() => _launchStatus;

    /// <summary>Whether the running process loads the protected project resources.</summary>
    public bool IsTrusted() => _launchStatus == "trusted";

    public TrustResult Result(string workspace) => new()
    {
        Status = _launchStatus,
        Workspace = workspace,
        ParentPath = TrustStore.ParentPath(workspace),
        PendingRestart = _restartPending,
        SessionOnly = _appliedOverride is not null,
        Options = TrustStore.Options(workspace),
    };

    /// <summary>
    /// Applies one option of the prompt; the returned result carries
    /// PendingRestart when a pi restart is required to make it effective.
    /// </summary>
    public TrustResult Apply(string workspace, string optionId)
    {
        var before = _launchStatus;
        var applied = TrustStore.ApplyOption(workspace, optionId, _dir);
        _pendingOverride = applied.SessionOverride;
        _restartPending = applied.Status != before;
        if (!_restartPending) _pendingOverride = null;
        return Result(workspace);
    }
}
