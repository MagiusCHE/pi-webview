// JSONL framing of pi's RPC protocol (docs/rpc.md) — C# mirror of
// src/bridge/jsonl.ts: split ONLY on \n (never Node's readline: it splits
// on U+2028/U+2029; StreamReader.ReadLine splits only on \r/\n → safe),
// accepts \r\n dropping the trailing \r.

using System.Text;
using System.Text.Json;

namespace PiWebview.Vs.Rpc;

/// <summary>JSONL writer to pi's stdin with queue + backpressure.
/// The queue is an unbounded channel; the write loop uses WriteAsync +
/// FlushAsync: upstream pressure propagates naturally (WriteAsync completes
/// when the process buffer is drained).</summary>
public sealed class JsonlWriter : IAsyncDisposable
{
    private readonly Stream _stdin;
    private readonly System.Threading.Channels.Channel<JsonElement> _queue =
        System.Threading.Channels.Channel.CreateUnbounded<JsonElement>(
            new System.Threading.Channels.UnboundedChannelOptions
            {
                SingleReader = true,
                SingleWriter = false,
            });
    private readonly Task _writeLoop;

    public JsonlWriter(Stream stdin)
    {
        _stdin = stdin;
        _writeLoop = WriteLoopAsync();
    }

    /// <summary>Queues a payload (serialized at write time).</summary>
    public void Send(JsonElement payload) => _queue.Writer.TryWrite(payload);

    private async Task WriteLoopAsync()
    {
        try
        {
            var reader = _queue.Reader;
            while (await reader.WaitToReadAsync().ConfigureAwait(false))
            {
                while (reader.TryRead(out var payload))
                {
                    var bytes = Encoding.UTF8.GetBytes(payload.GetRawText() + "\n");
                    await _stdin.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                    await _stdin.FlushAsync().ConfigureAwait(false);
                }
            }
        }
        catch (IOException)
        {
            // stdin closed (pi terminated): the residual queue is dropped
        }
        catch (ObjectDisposedException)
        {
            // stream closed during shutdown
        }
    }

    public async ValueTask DisposeAsync()
    {
        _queue.Writer.TryComplete();
        // drain the remainder with a short cap: if stdin is closed (pi dead)
        // the write fails and the loop exits by itself
        await Task.WhenAny(_writeLoop, Task.Delay(TimeSpan.FromSeconds(1))).ConfigureAwait(false);
    }
}

/// <summary>JSONL reader of pi's stdout: one line at a time, with an async
/// delivery callback. Non-JSON lines are reported but do not interrupt the
/// stream (same behavior as the TS parser).</summary>
public sealed class JsonlReader
{
    public static async Task ReadAsync(
        Stream stdout,
        Func<string, Task> onLine,
        Func<string, Task>? onUnparseable = null,
        CancellationToken ct = default)
    {
        using var reader = new StreamReader(stdout, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true);
        while (!ct.IsCancellationRequested)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync().ConfigureAwait(false);
            }
            catch (IOException)
            {
                return; // stdout closed (pi terminated)
            }
            catch (OperationCanceledException)
            {
                return;
            }
            if (line is null) return; // EOF
            if (line.Length == 0) continue;
            // ReadLineAsync already splits on \r\n removing both; a residual
            // trailing \r (mixed line terminators) is dropped
            if (line.EndsWith("\r")) line = line.Substring(0, line.Length - 1);
            try
            {
                using var _ = JsonDocument.Parse(line);
                await onLine(line).ConfigureAwait(false);
            }
            catch (JsonException)
            {
                if (onUnparseable is not null)
                {
                    var preview = line.Length > 120 ? line.Substring(0, 120) : line;
                    await onUnparseable(preview).ConfigureAwait(false);
                }
            }
        }
    }
}
