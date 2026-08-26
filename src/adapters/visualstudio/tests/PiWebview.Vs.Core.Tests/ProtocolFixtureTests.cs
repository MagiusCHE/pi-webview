// Deserialization of the shared IDE bridge protocol fixtures
// (concept 0005 D3): the same JSON files are validated by the TS tests —
// mitigation of the TS↔C# drift.

using System.Text.Json;
using PiWebview.Vs.Protocol;

namespace PiWebview.Vs.Core.Tests;

public sealed class ProtocolFixtureTests
{
    private static string FixtureDir() => Path.Combine(
        AppContext.BaseDirectory, "Fixtures");

    private static IEnumerable<string> Fixtures() =>
        Directory.GetFiles(FixtureDir(), "*.json").OrderBy(f => f);

    [Fact]
    public void Ogni_fixture_e_un_Frame_valido()
    {
        Assert.NotEmpty(Fixtures());
        foreach (var f in Fixtures())
        {
            var frame = Frame.Parse(File.ReadAllText(f));
            Assert.NotNull(frame);
            Assert.True(frame!.Channel is "rpc" or "ide", $"{f}: channel {frame.Channel}");
            Assert.Equal(JsonValueKind.Object, frame.Payload.ValueKind);
        }
    }

    [Fact]
    public void Richieste_ide_deserializzate_con_tipo_e_id()
    {
        var req = ReadRequest("frame-ide-request-getconfig.json");
        Assert.Equal("getConfig", req.Type);
        Assert.Equal("ide-1", req.Id);

        var setCfg = ReadRequest("frame-ide-request-setconfig.json");
        Assert.Equal("setConfig", setCfg.Type);
        Assert.NotNull(setCfg.Patch);
        Assert.True(setCfg.Patch!.TryGetValue("theme", out var theme));
        Assert.Equal("dark", theme.GetString());
        Assert.True(setCfg.Patch.TryGetValue("historyLimit", out var limit));
        Assert.Equal(30, limit.GetInt32());
    }

    [Fact]
    public void Store_session_con_path_windows()
    {
        var req = ReadRequest("frame-ide-request-setsession.json");
        Assert.Equal("storeSession", req.Type);
        Assert.Equal(@"C:\Users\utente\.pi\agent\sessions\--C--proj--\sess.jsonl", req.Path);
    }

    [Fact]
    public void Store_steer_queue_con_items()
    {
        var req = ReadRequest("frame-ide-request-storesteerqueue.json");
        Assert.Equal("storeSteerQueue", req.Type);
        Assert.NotNull(req.Items);
        Assert.Equal(2, req.Items!.Count);
        var first = req.Items[0];
        Assert.True(first.TryGetProperty("text", out var text));
        Assert.Equal("primo", text.GetString());
    }

    [Fact]
    public void Comando_rpc_passthrough()
    {
        var frame = Frame.Parse(File.ReadAllText(Path.Combine(FixtureDir(), "frame-rpc-command.json")))!;
        Assert.Equal("rpc", frame.Channel);
        Assert.Equal("prompt", frame.Payload.GetProperty("type").GetString());
        Assert.Equal("ciao", frame.Payload.GetProperty("message").GetString());
    }

    [Fact]
    public void Evento_selection_changed_deserializzato()
    {
        var frame = Frame.Parse(File.ReadAllText(Path.Combine(FixtureDir(), "frame-ide-event-selection.json")))!;
        var evt = frame.Payload.Deserialize<IdeEvent.SelectionChanged>(ProtocolJson.Options)!;
        Assert.Equal("selection_changed", evt.Type);
        Assert.Equal(@"C:\proj\src\main.cs", evt.FilePath);
        Assert.Equal(@"C:\proj", evt.WorkspaceFolder);
        var range = Assert.Single(evt.Ranges!);
        Assert.Equal("var x = 1;", range.Text);
        Assert.Equal(10, range.Selection.Start.Line);
        Assert.Equal(4, range.Selection.Start.Character);
        Assert.Equal(14, range.Selection.End.Character);
    }

    [Fact]
    public void Evento_selection_cleared_deserializzato()
    {
        var frame = Frame.Parse(File.ReadAllText(Path.Combine(FixtureDir(), "frame-ide-event-selection-cleared.json")))!;
        var evt = frame.Payload.Deserialize<IdeEvent.SelectionCleared>(ProtocolJson.Options)!;
        Assert.Equal("selection_cleared", evt.Type);
        Assert.Equal("empty-selection", evt.Reason);
    }

    [Fact]
    public void Risposta_ide_con_errore()
    {
        var frame = Frame.Parse(File.ReadAllText(Path.Combine(FixtureDir(), "frame-ide-response-error.json")))!;
        var res = frame.Payload.Deserialize<IdeResponse>(ProtocolJson.Options)!;
        Assert.False(res.Ok);
        Assert.Equal("ide-1", res.Id);
        Assert.NotNull(res.Error);
    }

    private static IdeRequest ReadRequest(string fixture)
    {
        var frame = Frame.Parse(File.ReadAllText(Path.Combine(FixtureDir(), fixture)))!;
        Assert.Equal("ide", frame.Channel);
        var req = IdeRequest.FromJson(frame.Payload);
        Assert.NotNull(req);
        return req!;
    }
}
