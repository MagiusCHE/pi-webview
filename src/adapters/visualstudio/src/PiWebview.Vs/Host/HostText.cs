// Minimal host-side localization for the Visual Studio companion (AGENTS.md:
// user-facing strings are NEVER hardcoded in one language — same pattern as
// hostT in src/adapters/vscode/host.ts). The locale comes from the shared
// user config (UserConfigStore, %APPDATA%\pi-webview\config.json), the same
// file the standalone bridge and the VS Code companion read.

namespace PiWebview.Vs.Host;

public static class HostText
{
    public static string? CurrentLocale { get; set; }

    /// <summary>Returns the translated string for the current locale; falls
    /// back to Italian (the default, like the webview i18n) when the locale
    /// is not "en".</summary>
    public static string T(string it, string en)
    {
        return CurrentLocale == "en" ? en : it;
    }
}
