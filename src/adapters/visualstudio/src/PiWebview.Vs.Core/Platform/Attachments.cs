// Attachments pasted into the chat — C# mirror of src/bridge/attachments.ts:
// save to disk (temp) and path checks.

using System.Security.Cryptography;
using System.Text;

namespace PiWebview.Vs.Platform;

public static class Attachments
{
    public static string AttachmentsDir() => Path.Combine(
        Path.GetTempPath(), "pi-webview-attachments");

    public static Dictionary<string, object?> SaveAttachment(
        string name, string mimeType, string dataBase64, string? dir = null)
    {
        dir ??= AttachmentsDir();
        var safe = Path.GetFileName(name);
        safe = string.Concat(safe.Select(ch => char.IsLetterOrDigit(ch) || ch is '.' or '-' or ' ' ? ch : '_'));
        if (safe.Length == 0) safe = "attachment";
        var random = RandomNumberGenerator.Create().GetHexString(4);
        var file = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{random}-{safe}";
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, file);
        File.WriteAllBytes(path, Convert.FromBase64String(dataBase64));
        var result = new Dictionary<string, object?> { ["path"] = path };
        if (mimeType.Length > 0) result["mimeType"] = mimeType;
        return result;
    }

    public static bool PathExists(string path)
    {
        try
        {
            return File.Exists(path) || Directory.Exists(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}

// Helper: RandomNumberGenerator.GetHexString does not exist in net8 → extension.
internal static class RandomNumberGeneratorExtensions
{
    public static string GetHexString(this RandomNumberGenerator rng, int byteCount)
    {
        var bytes = new byte[byteCount];
        rng.GetBytes(bytes);
        var sb = new StringBuilder(byteCount * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
