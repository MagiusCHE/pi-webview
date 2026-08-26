// Lightweight diagnostics: append log to C:\Temp\piwebview-vs.log
// (C:\Temp exists on the user's machine; fallback to %TEMP%).
// Used to pinpoint tool window creation failures (e.g. E_UNEXPECTED on
// VS 2022) without restarting with /log.

namespace PiWebview.Vs;

internal static class Diag
{
    public static void Log(string message)
    {
        try
        {
            var dir = @"C:\Temp";
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "piwebview-vs.log"),
                $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}\n");
        }
        catch
        {
            try
            {
                Directory.CreateDirectory(System.IO.Path.GetTempPath());
            }
            catch { /* niente da fare */ }
        }
    }
}
