// Internal hand-off used by the local artifact-update procedure. The token is
// carried in the environment instead of being printed or added to piw's CLI.

export const RESTART_TOKEN_ENV = "PIW_RESTART_TOKEN";

export function restartTokenFromEnvironment(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error(`${RESTART_TOKEN_ENV} non valido`);
  }
  return value;
}
