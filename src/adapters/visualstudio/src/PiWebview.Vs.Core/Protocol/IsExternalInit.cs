// Shim for init-only properties and records on netstandard2.0/net472
// (the type does not exist in pre-.NET 5 BCLs).

namespace System.Runtime.CompilerServices
{
    public static class IsExternalInit
    {
    }
}
