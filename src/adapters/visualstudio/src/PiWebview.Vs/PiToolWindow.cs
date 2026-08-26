// "pi" tool window (concept 0005 D1): dockable ToolWindowPane hosting the
// WebView2 webview.
//
// IMPORTANT: the Content MUST be set in the constructor (PiDevToolWindow
// pattern). VS creates the tool window frame right after the pane creation
// and calls GetWindow() on the content: if Content is null the creation
// fails with COMException 0x8000FFFF (E_UNEXPECTED) in
// Microsoft.VisualStudio.Platform.WindowManagement.UIElementDocumentObject.Init.

using System.Runtime.InteropServices;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;
using PiWebview.Vs.Host;

namespace PiWebview.Vs;

[Guid(GuidList.ToolWindowGuidString)]
public sealed class PiToolWindow : ToolWindowPane
{
    private PiWebviewHost? _host;
    private PiToolWindowControl? _control;
    private bool _disposed;

    public PiWebviewHost? Host => _host;

    public PiToolWindow() : base(null)
    {
        Caption = "pi";
        var dte = ServiceProvider.GlobalProvider.GetService(typeof(DTE)) as DTE2;
        _host = new PiWebviewHost(
            ThreadHelper.JoinableTaskFactory,
            dte!,
            new ToolWindowCallbacks());
        _control = new PiToolWindowControl(_host);
        Content = _control;
    }

    protected override void Dispose(bool disposing)
    {
        if (_disposed) return;
        _disposed = true;
        _control?.Detach();
        _control = null;
        if (_host is not null)
        {
            var host = _host;
            _host = null;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await host.DisposeAsync().ConfigureAwait(false);
            });
        }
        base.Dispose(disposing);
    }

    /// <summary>Callbacks for the host requests (single instance: "new chat"
    /// brings the existing window to front; the webview manages the chat
    /// inside it).</summary>
    private sealed class ToolWindowCallbacks : IPiHostCallbacks
    {
        public void OnNewChat()
        {
            _ = PiWebviewPackage.Instance?.ShowPiSafeAsync() ?? Task.CompletedTask;
        }

        public void OnError(string message) => PiWebviewPackage.Instance?.ShowMessage(message);

        public void OnWarning(string message) => PiWebviewPackage.Instance?.ShowMessage(message);

        public void OnSessionChange(string path)
        {
            // per-session per tool window: no global state to update
        }
    }
}
