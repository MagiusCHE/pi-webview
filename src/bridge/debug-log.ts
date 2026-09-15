const SENSITIVE_KEY = /(?:token|ticket|capability|authorization|cookie|password|secret)/i;
const PRIVATE_PAYLOAD_KEY = /^(?:content|html|imageDataUrl|dataBase64)$/i;
const SENSITIVE_QUERY_VALUE =
  /([?&](?:token|handoff|ticket|capability|authorization|password|secret)=)[^&\s"']*/gi;

export function redactDebugFrame(frame: unknown): string {
  return JSON.stringify(frame, (key, value: unknown) => {
    if (SENSITIVE_KEY.test(key) || PRIVATE_PAYLOAD_KEY.test(key)) {
      return "<redacted>";
    }
    return typeof value === "string"
      ? value.replace(SENSITIVE_QUERY_VALUE, "$1<redacted>")
      : value;
  });
}
