export function browserDefaultWorkspace(
  client: string | null,
  userHome: string,
): string | undefined {
  return client === "browser" ? userHome : undefined;
}
