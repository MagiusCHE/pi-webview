// GUIDs of the package, the command set and the tool window (concept 0005 D1).

namespace PiWebview.Vs;

internal static class GuidList
{
    public const string PackageGuidString = "7f2e5c1a-3b6d-4e8f-9a2c-1d4e5f6a7b8c";
    public const string CommandSetGuidString = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    // GUID changed (2026-08-25): the old tool window frame (Linked/
    // MultiInstances docking, corrupted layout) was restored at boot and
    // crashed VS in WindowManagement. New GUID → no layout to restore.
    public const string ToolWindowGuidString = "04a92261-434b-415f-8ff4-720139c56775";

    public static readonly Guid CommandSet = new(CommandSetGuidString);
    public static readonly Guid ToolWindow = new(ToolWindowGuidString);
}

internal static class PkgCmdIdList
{
    public const uint AttachSelection = 0x0100;
    public const uint Focus = 0x0101;
}
