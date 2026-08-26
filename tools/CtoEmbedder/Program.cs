// Adds (or replaces) an embedded resource in a .NET assembly using Mono.Cecil.
// Usage: CtoEmbedder.exe <assembly.dll> <resource-file> <resource-name>
using System;
using System.IO;
using Mono.Cecil;

if (args.Length != 3)
{
    Console.Error.WriteLine("Usage: CtoEmbedder.exe <assembly.dll> <resource-file> <resource-name>");
    return 2;
}

var assemblyPath = Path.GetFullPath(args[0]);
var resourceFile = Path.GetFullPath(args[1]);
var resourceName = args[2];

var resolver = new DefaultAssemblyResolver();
resolver.AddSearchDirectory(Path.GetDirectoryName(assemblyPath));

var tmpPath = assemblyPath + ".tmp";

using (var assembly = AssemblyDefinition.ReadAssembly(assemblyPath, new ReaderParameters { AssemblyResolver = resolver }))
{
    // Remove existing resource with the same name
    for (var i = assembly.MainModule.Resources.Count - 1; i >= 0; i--)
    {
        if (assembly.MainModule.Resources[i].Name == resourceName)
            assembly.MainModule.Resources.RemoveAt(i);
    }

    var embedded = new EmbeddedResource(resourceName, ManifestResourceAttributes.Public,
        File.ReadAllBytes(resourceFile));
    assembly.MainModule.Resources.Add(embedded);

    assembly.Write(tmpPath);
}

File.Delete(assemblyPath);
File.Move(tmpPath, assemblyPath);

Console.WriteLine($"Embedded '{resourceName}' ({new FileInfo(resourceFile).Length} bytes) into {assemblyPath}");
return 0;
