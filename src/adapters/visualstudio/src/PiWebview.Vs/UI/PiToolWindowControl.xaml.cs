// WPF control hosting WebView2 as the UI ↔ host bridge (concept 0005
// D1/D2): virtual host "piw.local" → dist/web (the vite-built UI),
// WebMessageReceived → host, host → PostWebMessageAsJson.
//
// Rehost note: when the tool window is docked/undocked (tab), VS re-parents
// the control and the WPF WebView2 loses its rendering host without
// recovering by itself: at the next Loaded the control is recreated (same
// CoreWebView2Environment → same core, new visual).

using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using PiWebview.Vs.Host;
using Frame = PiWebview.Vs.Protocol.Frame;

namespace PiWebview.Vs;

public partial class PiToolWindowControl : UserControl
{
    private readonly PiWebviewHost _host;
    private bool _started;
    private CoreWebView2Environment? _env;
    private Microsoft.Web.WebView2.Wpf.WebView2? _web;

    public PiToolWindowControl(PiWebviewHost host)
    {
        InitializeComponent();
        _host = host;
        host.PostJson = PostJsonToWeb;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            // Re-host (docking/tab): recreate the control with the same core
            // environment (pi stays active, the UI does a new boot).
            Diag.Log("[ctrl] loaded: rehost");
            try
            {
                await RehostWebViewAsync();
            }
            catch (Exception ex)
            {
            _host.Callbacks.OnError(HostText.T(
                $"Impossibile rigenerare la webview: {ex.Message}",
                $"Cannot regenerate the webview: {ex.Message}"));
            }
            return;
        }
        _started = true;
        Diag.Log("[ctrl] loaded: first init");
        try
        {
            // dedicated user data folder: never conflicts with other webview2
            var userDataFolder = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "pi-webview-vs-webview2");
            _env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await AttachWebViewAsync();
        }
        catch (Exception ex)
        {
            _host.Callbacks.OnError(HostText.T(
                $"Impossibile inizializzare WebView2: {ex.Message}",
                $"Cannot initialize WebView2: {ex.Message}"));
            return;
        }
        _host.StartPi();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        // The pane can be closed/re-docked: the next Loaded handles both the
        // first start and the rehost. Nothing destructive happens here.
        Diag.Log("[ctrl] unloaded");
    }

    /// <summary>After a re-host the old WebView2 lost its visual: close it
    /// and create a new one (same environment).</summary>
    private async Task RehostWebViewAsync()
    {
        if (_env is null) return;
        await AttachWebViewAsync();
    }

    private async Task AttachWebViewAsync()
    {
        var old = _web;
        if (old is not null)
        {
            old.CoreWebView2?.WebMessageReceived -= OnWebMessageReceived;
            HostGrid.Children.Remove(old);
            try
            {
                old.Dispose();
            }
            catch (Exception)
            {
                // already closed: ok
            }
            old = null;
        }

        var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
        _web = wv;
        HostGrid.Children.Add(wv);
        await wv.EnsureCoreWebView2Async(_env);

        var webDir = System.IO.Path.Combine(
            System.IO.Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".",
            "dist", "web");
        wv.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "piw.local", webDir, CoreWebView2HostResourceAccessKind.Allow);
        wv.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        wv.CoreWebView2.Settings.IsStatusBarEnabled = false;
        wv.CoreWebView2.Navigate("https://piw.local/index.html");
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            Diag.Log("webview→host: " + Truncate(e.WebMessageAsJson, 220));
            var frame = Frame.Parse(e.WebMessageAsJson);
            if (frame is null) return; // messaggio non-frame: ignorato
            _host.HandleFrame(frame);
        }
        catch (JsonException)
        {
            // malformed frame: ignored
        }
    }

    /// <summary>Host → webview channel. Callable from any thread (pi events
    /// arrive from the pool): marshals onto the WPF dispatcher.</summary>
    private void PostJsonToWeb(string json)
    {
        try
        {
            if (!Dispatcher.CheckAccess())
            {
                // Never synchronously wait for the VS/WPF UI thread from the
                // pi stdout reader. A WebView2 callback can be temporarily
                // busy while docking or navigating; Invoke here would stop
                // the JSONL pump and make pi appear frozen.
                Dispatcher.BeginInvoke(new Action(() => PostJsonToWeb(json)));
                return;
            }

            var wv = _web;
            var core = wv?.CoreWebView2;
            if (core is null) return;
            Diag.Log("host→webview: " + Truncate(json, 220));
            core.PostWebMessageAsJson(json);
        }
        catch (Exception ex)
        {
            // A stale WebView2 during re-hosting must not kill the pi reader.
            Diag.Log("host→webview failed: " + ex.Message);
        }
    }

    /// <summary>Called by the pane at close: detaches the host channel.</summary>
    public void Detach()
    {
        _host.PostJson = null;
        if (_web?.CoreWebView2 is not null)
        {
            _web.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
        }
    }

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s.Substring(0, max) + "…";
}
