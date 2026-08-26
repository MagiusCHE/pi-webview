// Editor selection → selection_changed / selection_cleared of the protocol
// (concept 0005 D5). DTE does not expose raw caret/selection well: the MEF
// events of the active text view are used (ITextCaret.PositionChanged,
// ITextSelection.SelectionChanged) + WindowActivated to follow the active
// editor. 150ms debounce, same semantics as the VS Code companion:
// - focus on non-editor windows → do NOT clear: republish the last selection
// - empty selection in the active file → selection_cleared (empty-selection)
// - no file ever selected → selection_cleared (no-active-file)

using System.Text.Json;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Editor;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.TextManager.Interop;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Editor;

public sealed class SelectionTracker : IDisposable
{
    private readonly DTE2 _dte;
    private readonly IVsTextManager _textManager;
    private readonly IVsEditorAdaptersFactoryService _adapterFactory;
    private readonly Func<string?> _workspace;
    private readonly List<Action<IdeEvent>> _listeners = new();
    private readonly System.Threading.Timer _debounce;
    private IWpfTextView? _view;
    private LastSelection? _last;

    private sealed record LastSelection(string? FilePath, string? WorkspaceFolder, List<SelectionRange> Ranges);

    public SelectionTracker(
        DTE2 dte,
        IVsTextManager textManager,
        IVsEditorAdaptersFactoryService adapterFactory,
        Func<string?> workspace)
    {
        _dte = dte;
        _textManager = textManager;
        _adapterFactory = adapterFactory;
        _workspace = workspace;
        _debounce = new System.Threading.Timer(
            _ => PostSelection(),
            null,
            Timeout.Infinite,
            Timeout.Infinite);
        _dte.Events.WindowEvents.WindowActivated += OnWindowActivated;
        RefreshActiveView();
        PostSelection();
    }

    public void Subscribe(Action<IdeEvent> listener) => _listeners.Add(listener);

    public void Unsubscribe(Action<IdeEvent> listener) => _listeners.Remove(listener);

    private void OnWindowActivated(Window gotFocus, Window lostFocus)
    {
        // l'editor attivo può essere cambiato: riaggancia il text view giusto
        RefreshActiveView();
        Schedule();
    }

    private void RefreshActiveView()
    {
        UnhookView();
        try
        {
            if (_textManager.GetActiveView(1, null, out var vsView) != 0) return;
            _view = _adapterFactory.GetWpfTextView(vsView);
            if (_view is null) return;
            _view.Caret.PositionChanged += OnSelectionEvent;
            _view.Selection.SelectionChanged += OnSelectionEvent;
            _view.Closed += OnViewClosed;
        }
        catch (Exception)
        {
            // non-adaptable view (e.g. non-editor windows): no active view
            _view = null;
        }
    }

    private void OnViewClosed(object? sender, EventArgs e) => Schedule();

    private void OnSelectionEvent(object? sender, EventArgs e) => Schedule();

    private void Schedule()
    {
        _debounce.Change(150, Timeout.Infinite);
    }

    private void UnhookView()
    {
        if (_view is null) return;
        _view.Caret.PositionChanged -= OnSelectionEvent;
        _view.Selection.SelectionChanged -= OnSelectionEvent;
        _view.Closed -= OnViewClosed;
        _view = null;
    }

    public void PostSelection()
    {
        var view = _view;
        if (view is null || view.IsClosed)
        {
            if (_last is not null)
            {
                // focus on webview/terminal/panel: do NOT clear — republish
                // the last known selection (same behavior as VS Code)
                Broadcast(new IdeEvent.SelectionChanged
                {
                    FilePath = _last.FilePath,
                    WorkspaceFolder = _last.WorkspaceFolder,
                    Ranges = _last.Ranges,
                });
                return;
            }
            Broadcast(new IdeEvent.SelectionCleared { Reason = "no-active-file" });
            return;
        }

        var doc = GetDocument(view);
        if (doc is null)
        {
            Broadcast(new IdeEvent.SelectionCleared { Reason = "no-active-file" });
            return;
        }

        var ranges = new List<SelectionRange>();
        foreach (var span in view.Selection.SelectedSpans)
        {
            if (span.IsEmpty) continue;
            var snapshot = span.Snapshot;
            var startLine = snapshot.GetLineFromPosition(span.Start.Position);
            var endLine = snapshot.GetLineFromPosition(span.End.Position);
            ranges.Add(new SelectionRange
            {
                Text = span.GetText(),
                Selection = new LineRange
                {
                    Start = new Position
                    {
                        Line = startLine.LineNumber,
                        Character = span.Start.Position - startLine.Start.Position,
                    },
                    End = new Position
                    {
                        Line = endLine.LineNumber,
                        Character = span.End.Position - endLine.Start.Position,
                    },
                },
            });
        }

        var filePath = doc.FilePath;
        var workspaceFolder = _workspace();

        if (ranges.Count > 0)
        {
            _last = new LastSelection(filePath, workspaceFolder, ranges);
            Broadcast(new IdeEvent.SelectionChanged
            {
                FilePath = filePath,
                WorkspaceFolder = workspaceFolder,
                Ranges = ranges,
            });
            TryAtMention(ranges, workspaceFolder);
            return;
        }

        // EMPTY selection in the active file: the user really deselected
        _last = null;
        Broadcast(new IdeEvent.SelectionCleared { Reason = "empty-selection" });
    }

    private void TryAtMention(List<SelectionRange> ranges, string? workspaceFolder)
    {
        if (ranges.Count != 1) return;
        var text = ranges[0].Text.Trim();
        if (!text.StartsWith("@") || text.Length <= 1) return;
        var path = text.Substring(1).Trim('"', '\'');
        string? full = null;
        if (Path.IsPathRooted(path) && (File.Exists(path) || Directory.Exists(path))) full = path;
        else if (workspaceFolder is not null)
        {
            var candidate = Path.Combine(workspaceFolder, path);
            if (File.Exists(candidate) || Directory.Exists(candidate)) full = candidate;
        }
        if (full is null) return;
        Broadcast(new IdeEvent.AtMentioned { FilePath = full, RangeText = text });
    }

    private void Broadcast(IdeEvent evt)
    {
        foreach (var l in _listeners)
        {
            try
            {
                l(evt);
            }
            catch (Exception)
            {
                // a broken listener must not block the others
            }
        }
    }

    private static Microsoft.VisualStudio.Text.ITextDocument? GetDocument(IWpfTextView view)
    {
        return view.TextBuffer.Properties.TryGetProperty(
            typeof(Microsoft.VisualStudio.Text.ITextDocument),
            out Microsoft.VisualStudio.Text.ITextDocument doc)
            ? doc
            : null;
    }

    public void Dispose()
    {
        _dte.Events.WindowEvents.WindowActivated -= OnWindowActivated;
        UnhookView();
        _debounce.Dispose();
    }
}

// JsonElement used only for payload clarity in future logs.
internal static class SelectionJson
{
    public static string Serialize(IdeEvent evt) =>
        JsonSerializer.Serialize(evt, ProtocolJson.Options);
}
