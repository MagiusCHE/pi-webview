// JSONL framing tests (mirror of tests/jsonl.test.ts): writer/reader
// roundtrip, split only on \n, trailing \r dropped, non-JSON lines
// reported without interrupting.

using System.Text;
using System.Text.Json;
using PiWebview.Vs.Rpc;

namespace PiWebview.Vs.Core.Tests;

public sealed class JsonlTests
{
    [Fact]
    public async Task Roundtrip_writer_reader()
    {
        using var ms = new MemoryStream();
        var writer = new JsonlWriter(ms);
        using var payload1 = JsonDocument.Parse("{\"type\":\"prompt\",\"message\":\"a\\nb\"}");
        using var payload2 = JsonDocument.Parse("{\"type\":\"abort\"}");
        writer.Send(payload1.RootElement);
        writer.Send(payload2.RootElement);
        await writer.DisposeAsync(); // completes the queue and waits for the drain

        ms.Position = 0;
        var lines = new List<string>();
        await JsonlReader.ReadAsync(ms, line => { lines.Add(line); return Task.CompletedTask; });

        Assert.Equal(2, lines.Count);
        Assert.Equal("{\"type\":\"prompt\",\"message\":\"a\\nb\"}", lines[0]);
        Assert.Equal("{\"type\":\"abort\"}", lines[1]);
    }

    [Fact]
    public async Task Reader_accetta_crlf_e_scarta_il_cr()
    {
        var bytes = Encoding.UTF8.GetBytes(
            "{\"type\":\"a\"}\r\n{\"type\":\"b\"}\n{\"type\":\"c\"}");
        using var ms = new MemoryStream(bytes);
        var lines = new List<string>();
        await JsonlReader.ReadAsync(ms, line => { lines.Add(line); return Task.CompletedTask; });
        Assert.Equal(new[] { "{\"type\":\"a\"}", "{\"type\":\"b\"}", "{\"type\":\"c\"}" }, lines);
    }

    [Fact]
    public async Task Reader_segnala_le_righe_non_json_senza_interrompere()
    {
        var bytes = Encoding.UTF8.GetBytes("garbage\n{\"type\":\"ok\"}");
        using var ms = new MemoryStream(bytes);
        var lines = new List<string>();
        var bad = new List<string>();
        await JsonlReader.ReadAsync(
            ms,
            line => { lines.Add(line); return Task.CompletedTask; },
            raw => { bad.Add(raw); return Task.CompletedTask; });
        Assert.Equal(new[] { "{\"type\":\"ok\"}" }, lines);
        Assert.Equal(new[] { "garbage" }, bad);
    }

    [Fact]
    public async Task Reader_mai_split_su_u2028()
    {
        // U+2028 (line separator) must NOT break the line (docs/rpc.md
        // warning: only \n delimits)
        var json = "{\"type\":\"a\",\"text\":\"x\u2028y\"}";
        var bytes = Encoding.UTF8.GetBytes(json + "\n{\"type\":\"b\"}");
        using var ms = new MemoryStream(bytes);
        var lines = new List<string>();
        await JsonlReader.ReadAsync(ms, line => { lines.Add(line); return Task.CompletedTask; });
        Assert.Equal(2, lines.Count);
        Assert.Equal(json, lines[0]);
    }
}
