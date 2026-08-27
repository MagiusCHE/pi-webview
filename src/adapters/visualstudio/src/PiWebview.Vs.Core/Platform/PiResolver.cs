// Resolution of the `pi` binary and the bash required on Windows —
// C# mirror of src/bridge/spawn.ts (concept 0002 D6, concept 0005 D4).
// Windows: the npm pi.cmd shim run via cmd /c with piped stdio BREAKS pi's
// RPC stdin (boot completes but nothing answers; verified v0.84.3): so we
// also resolve node + the cli.js entry for the DIRECT SPAWN (the same
// pattern as pi's own internal RpcClient).

using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace PiWebview.Vs.Platform;

public sealed record PiResolution(string Command, bool Found, string? Path)
{
    /// <summary>Direct spawn node &lt;ScriptPath&gt; --mode rpc. Null on
    /// non-Windows or when the resolution fails (falls back to the shim via
    /// cmd /c, the previous behavior).</summary>
    public string? NodePath { get; init; }
    public string? ScriptPath { get; init; }
    public bool HasDirectInvocation => NodePath is not null && ScriptPath is not null;
}

public static class PiResolver
{
    /// <summary>On Windows the npm shim is pi.cmd (never run directly:
    /// PiProcess goes through cmd.exe /c).</summary>
    public static string PiBinName() =>
        RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "pi.cmd" : "pi";

    public static string? FindOnPath(string bin, string? pathEnv = null)
    {
        pathEnv ??= Environment.GetEnvironmentVariable("PATH") ?? "";
        var exts = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? new[] { ".cmd", ".exe", ".bat", "" }
            : new[] { "" };
        foreach (var dir in pathEnv.Split(Path.PathSeparator))
        {
            if (dir.Length == 0) continue;
            foreach (var ext in exts)
            {
                var candidate = Path.Combine(dir, bin + ext);
                try
                {
                    if (File.Exists(candidate)) return candidate;
                }
                catch (IOException)
                {
                    // next candidate
                }
            }
        }
        return null;
    }

    public static PiResolution ResolvePi()
    {
        var bin = PiBinName();
        var path = FindOnPath(bin);
        if (path is null && RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            // Fallback: the npm shim lives in %APPDATA%\npm (npm global
            // prefix), which may be missing from devenv's PATH (e.g. VS
            // launched as admin or from a wrapper).
            var npmDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "npm");
            try
            {
                var candidate = Path.Combine(npmDir, bin);
                if (File.Exists(candidate)) path = candidate;
            }
            catch (IOException)
            {
                // ignore: fallback below stays null
            }
        }
        var res = new PiResolution(bin, path is not null, path);
        if (path is null || !RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return res;
        return res with
        {
            NodePath = FindNodeExe(path),
            ScriptPath = ParseShimScript(path),
        };
    }

    /// <summary>node.exe: PATH, shim dir (%APPDATA%\npm), Program Files.</summary>
    public static string? FindNodeExe(string? shimPath = null)
    {
        var onPath = FindOnPath("node.exe");
        if (onPath is not null) return onPath;
        var candidates = new List<string>();
        if (shimPath is not null)
        {
            var shimDir = Path.GetDirectoryName(shimPath);
            if (shimDir is not null) candidates.Add(Path.Combine(shimDir, "node.exe"));
        }
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pfx86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        if (pf.Length > 0) candidates.Add(Path.Combine(pf, "nodejs", "node.exe"));
        if (pfx86.Length > 0) candidates.Add(Path.Combine(pfx86, "nodejs", "node.exe"));
        foreach (var c in candidates)
        {
            try
            {
                if (File.Exists(c)) return c;
            }
            catch (IOException)
            {
                // next candidate
            }
        }
        return null;
    }

    /// <summary>From the npm pi.cmd shim content extracts the real JS entry
    /// (…\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js).</summary>
    public static string? ParseShimScript(string shimPath)
    {
        try
        {
            var text = File.ReadAllText(shimPath);
            const string marker = "node_modules\\";
            var i = text.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
            if (i < 0) return null;
            var start = i + marker.Length;
            var end = start;
            while (end < text.Length && text[end] != '"' && text[end] != '%' &&
                   text[end] != ' ' && text[end] != '\r' && text[end] != '\n') end++;
            var rel = text.Substring(start, end - start).Replace('/', '\\');
            var shimDir = Path.GetDirectoryName(shimPath);
            if (shimDir is null || rel.Length == 0 ||
                !rel.ToLowerInvariant().EndsWith(".js")) return null;
            var script = Path.Combine(shimDir, "node_modules", rel);
            return File.Exists(script) ? script : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }
}

public static class BashDetector
{
    /// <summary>Looks for the shell used by pi's default bash tool in PATH and
    /// in typical Git Bash / MSYS2 / Cygwin / WSL locations. Returns the
    /// directory to prepend to the pi process PATH, or null when none is found.
    /// Shell errors remain the responsibility of the pi core.</summary>
    public static string? FindBashDir()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return null;
        var onPath = PiResolver.FindOnPath("bash");
        if (onPath is not null)
        {
            return Path.GetDirectoryName(onPath);
        }
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var candidates = new List<string>
        {
            Path.Combine(programFiles, "Git", "bin"),
            Path.Combine(programFiles, "Git", "usr", "bin"),
            Path.Combine(programFilesX86, "Git", "bin"),
            Path.Combine(programFilesX86, "Git", "usr", "bin"),
            @"C:\msys64\usr\bin",
            @"C:\cygwin64\bin",
            @"C:\cygwin\bin",
            // WSL: C:\Windows\System32\bash.exe è il launcher (ultima istanza)
            Environment.GetFolderPath(Environment.SpecialFolder.System),
        };
        foreach (var dir in candidates)
        {
            if (dir.Length == 0) continue;
            try
            {
                if (File.Exists(Path.Combine(dir, "bash.exe"))) return dir;
            }
            catch (IOException)
            {
                // next candidate
            }
        }
        // wsl.exe is not a bash directory that can be prepended to PATH;
        // leave any configured WSL resolution to the pi core.
        return null;
    }
}
