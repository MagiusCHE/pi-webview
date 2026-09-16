export function browserDefaultWorkspace(
  client: string | null,
  userHome: string,
): string | undefined {
  return client === "browser" ? userHome : undefined;
}

export function browserNewSessionWorkspace(
  client: string | null,
  userHome: string,
  launchWorkspace?: string,
): string | undefined {
  return launchWorkspace ?? browserDefaultWorkspace(client, userHome);
}
