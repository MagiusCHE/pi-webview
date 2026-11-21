namespace PiWebview.Vs.Platform;

public static class LinkImagePreview
{
    private const int MaxBytes = 8 * 1024 * 1024;

    public static Dictionary<string, object?>? Read(string path)
    {
        var mimeType = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".avif" => "image/avif",
            ".bmp" => "image/bmp",
            _ => null,
        };
        if (mimeType is null) return null;
        try
        {
            using var file = File.OpenRead(path);
            var size = file.Length;
            if (size <= 0 || size > MaxBytes) return null;
            var bytes = new byte[size];
            var prefix = (int)Math.Min(12, size);
            if (file.Read(bytes, 0, prefix) != prefix || !MatchesHeader(mimeType, bytes)) return null;
            for (var read = prefix; read < bytes.Length; )
            {
                var count = file.Read(bytes, read, bytes.Length - read);
                if (count == 0) return null;
                read += count;
            }
            return new() { ["mimeType"] = mimeType, ["dataBase64"] = Convert.ToBase64String(bytes) };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static bool MatchesHeader(string mimeType, byte[] bytes)
    {
        bool Has(int offset, params byte[] signature)
        {
            if (bytes.Length < offset + signature.Length) return false;
            for (var i = 0; i < signature.Length; i++)
                if (bytes[offset + i] != signature[i]) return false;
            return true;
        }
        return mimeType switch
        {
            "image/png" => Has(0, 137, 80, 78, 71, 13, 10, 26, 10),
            "image/jpeg" => Has(0, 255, 216, 255),
            "image/gif" => Has(0, 71, 73, 70, 56, 55, 97) || Has(0, 71, 73, 70, 56, 57, 97),
            "image/webp" => Has(0, 82, 73, 70, 70) && Has(8, 87, 69, 66, 80),
            "image/avif" => Has(4, 102, 116, 121, 112, 97, 118, 105, 102) || Has(4, 102, 116, 121, 112, 97, 118, 105, 115),
            "image/bmp" => Has(0, 66, 77),
            _ => false,
        };
    }
}
