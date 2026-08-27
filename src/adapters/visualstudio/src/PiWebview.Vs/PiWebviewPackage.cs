// Entry point of the Visual Studio extension (concept 0005): registers the
// tool window, the "show window" command (View > Other Windows), the global
// SelectionTracker and consumes the reload signal (concept 0004).

using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.Editor;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.TextManager.Interop;
using PiWebview.Vs.Editor;
using PiWebview.Vs.Host;
using PiWebview.Vs.Platform;
using Task = System.Threading.Tasks.Task;

namespace PiWebview.Vs;

[PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
[InstalledProductRegistration("#110", "#112", "0.1.2")]
[ProvideMenuResource("Menus.ctmenu", 1)]
// Autoload on open solution (proven PiDev pattern): the package activates in
// background load. Do NOT open the tool window in InitializeAsync → VS
// freezes at startup (verified 2026-08-25). The window opens on demand from
// the "pi" entry in View > Other Windows (Commands.vsct button, with icon).
[ProvideAutoLoad(UIContextGuids80.SolutionExists, PackageAutoLoadFlags.BackgroundLoad)]
[ProvideToolWindow(
    typeof(PiToolWindow),
    Style = VsDockStyle.Tabbed,
    Orientation = ToolWindowOrientation.Left)]
[Guid(PiWebviewPackage.PackageGuidString)]
public sealed class PiWebviewPackage : AsyncPackage
{
    public const string PackageGuidString = GuidList.PackageGuidString;

    /// <summary>Current instance (the pane uses it for callbacks/ShowMessage).
    /// PiDev pattern.</summary>
    public static PiWebviewPackage? Instance { get; private set; }

    private readonly List<PiToolWindow> _windows = new();
    private readonly List<System.IDisposable> _lastCrashNets = new();
    private SelectionTracker? _selectionTracker;
    private FileSystemWatcher? _reloadWatcher;

    protected override async Task InitializeAsync(
        CancellationToken cancellationToken,
        IProgress<ServiceProgressData> progress)
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        Instance = this;

        // Safety net: never crash VS because of an extension exception.
        // Logs to Diag (the shared file) and handles the WPF unhandled exception.
        InstallCrashNet(_lastCrashNets);
        Diag.Log("pkg: initialized");

        // --- comandi ---------------------------------------------------------
        if (await GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService mcs)
        {
            // "pi" entry in View > Other Windows (Commands.vsct button): opens
            // the tool window. The editor selection is tracked automatically
            // (SelectionTracker) — no manual attach/focus menu triggers.
            AddCommand(mcs, PkgCmdIdList.ShowWindow, async (_, _) => await ShowPiSafeAsync());
        }

        // --- selezione editor (MEF + DTE) ------------------------------------
        var componentModel = await GetServiceAsync(typeof(SComponentModel)) as IComponentModel;
        var adapterFactory = componentModel?.GetService<IVsEditorAdaptersFactoryService>();
        var textManager = await GetServiceAsync(typeof(SVsTextManager)) as IVsTextManager;
        var dte = await GetServiceAsync(typeof(DTE)) as DTE2;
        if (adapterFactory is not null && textManager is not null && dte is not null)
        {
            _selectionTracker = new SelectionTracker(dte, textManager, adapterFactory, Workspace);
            // broadcast to all active webviews (same behavior as the VS Code
            // companion: every webview receives the selection)
            _selectionTracker.Subscribe(evt =>
            {
                foreach (var w in _windows)
                {
                    w.Host?.PostIdeEvent(evt);
                }
            });
        }

        // --- reload signal (concept 0004) ------------------------------------
        var installedVersion = typeof(PiWebviewPackage).Assembly.GetName().Version?.ToString() ?? "";
        var pending = ReloadSignal.Check(installedVersion);
        if (pending is not null) NotifyReload(pending);
        _reloadWatcher = ReloadSignal.Watch(signalVersion =>
        {
            if (signalVersion.Length > 0 && signalVersion != installedVersion)
            {
                NotifyReload(signalVersion);
            }
        });
    }

    // --- gestione istanze -----------------------------------------------------

    private string? Workspace() =>
        JoinableTaskFactory.Run<string?>(async () => WorkspaceSync());

    private string? WorkspaceSync()
    {
        try
        {
            if (GetService(typeof(DTE)) is not DTE2 dte) return null;
            var solution = dte.Solution;
            if (solution is not null && solution.FullName is { Length: > 0 } full)
            {
                return System.IO.Path.GetDirectoryName(full);
            }
            var doc = dte.ActiveDocument;
            if (doc is not null && doc.FullName is { Length: > 0 } docFull)
            {
                return System.IO.Path.GetDirectoryName(docFull);
            }
        }
        catch (Exception)
        {
            // fallback below
        }
        return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    private IPiHostCallbacks CreateCallbacks() => new PackageCallbacks(this);

    private sealed class PackageCallbacks : IPiHostCallbacks
    {
        private readonly PiWebviewPackage _pkg;
        public PackageCallbacks(PiWebviewPackage pkg) => _pkg = pkg;

        public void OnNewChat() => _ = _pkg.JoinableTaskFactory.RunAsync(
            async () => await _pkg.CreatePiWindowAsync().ConfigureAwait(false));

        public void OnError(string message) => _pkg.ShowMessage(message);

        public void OnWarning(string message) => _pkg.ShowMessage(message);

        public void OnSessionChange(string path)
        {
            // per-session per tool window: no global state to update
        }
    }

    private async Task<PiToolWindow> CreatePiWindowAsync()
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync();
        Diag.Log("create: on ui thread");
        var pane = await FindToolWindowAsync(
            typeof(PiToolWindow), 0, create: true, DisposalToken);
        Diag.Log("create: findtoolwindow ok");
        var window = (PiToolWindow)pane;
        _windows.Add(window);
        return window;
    }

    private async Task ShowPiAsync()
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync();
        var window = _windows.Count > 0 ? _windows[0] : await CreatePiWindowAsync();
        ((IVsWindowFrame)window.Frame).Show();
    }

    /// <summary>Shows the pi window with try/catch: a creation error ends up
    /// in a message box, never in a VS crash (PiDev pattern).</summary>
    internal async Task ShowPiSafeAsync()
    {
        try
        {
            Diag.Log("focus: start");
            await ShowPiAsync();
            Diag.Log("focus: ok");
        }
        catch (Exception ex)
        {
            Diag.Log("focus: FAILED: " + ex);
            ShowMessage(HostText.T(
                $"Impossibile aprire la finestra pi: {ex.Message}",
                $"Cannot open the pi window: {ex.Message}"));
        }
    }

    // --- messaggi -------------------------------------------------------------

    internal void ShowMessage(string message)
    {
        _ = JoinableTaskFactory.RunAsync(async () =>
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync();
            VsShellUtilities.ShowMessageBox(
                this,
                message,
                "pi",
                OLEMSGICON.OLEMSGICON_WARNING,
                OLEMSGBUTTON.OLEMSGBUTTON_OK,
                OLEMSGDEFBUTTON.OLEMSGDEFBUTTON_FIRST);
        });
    }

    private void NotifyReload(string signalVersion)
    {
        ShowMessage(HostText.T(
            $"pi-webview: companion aggiornato alla versione {signalVersion}. " +
            "Riavvia Visual Studio per attivare la nuova versione.",
            $"pi-webview: companion updated to version {signalVersion}. " +
            "Restart Visual Studio to activate the new version."));
    }

    // --- safety net (unhandled) ----------------------------------------------

    /// <summary>Handles unhandled exceptions: logs to Diag, never a silent
    /// crash. For the WPF dispatcher the exception is also swallowed
    /// (Handled = true) so VS does not lose the session.</summary>
    private void InstallCrashNet(System.Collections.Generic.List<System.IDisposable> nets)
    {
        nets.Clear();
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Diag.Log("appdomain unhandled: " + e.ExceptionObject);
        if (System.Windows.Application.Current is { } app)
        {
            app.Dispatcher.UnhandledException += (_, e) =>
            {
                Diag.Log("wpf unhandled: " + e.Exception);
                e.Handled = true;
            };
        }
        nets.Add(new NoopDisposable());
    }

    private sealed class NoopDisposable : System.IDisposable
    {
        public void Dispose() { }
    }

    // --- comandi --------------------------------------------------------------

    private void AddCommand(OleMenuCommandService mcs, uint id, EventHandler handler)
    {
        var commandId = new CommandID(GuidList.CommandSet, (int)id);
        var command = new OleMenuCommand(handler, commandId);
        mcs.AddCommand(command);
    }

    private void AddCommand(OleMenuCommandService mcs, uint id, Func<object?, EventArgs, Task> handler)
    {
        var commandId = new CommandID(GuidList.CommandSet, (int)id);
        var command = new OleMenuCommand(async (s, e) => await handler(s, e), commandId);
        mcs.AddCommand(command);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            foreach (var net in _lastCrashNets) net.Dispose();
            _lastCrashNets.Clear();
            _reloadWatcher?.Dispose();
            _reloadWatcher = null;
            _selectionTracker?.Dispose();
            _selectionTracker = null;
            _windows.Clear();
        }
        base.Dispose(disposing);
    }
}
