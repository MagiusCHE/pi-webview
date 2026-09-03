import { isIP } from "node:net";

export const LOOPBACK_IP = "127.0.0.1";
export const ALL_IPV4_INTERFACES = "0.0.0.0";

/** Validates the CLI bind value. The standalone bridge currently uses IPv4. */
export function normalizeBindIp(value?: string): string {
  const ip = value?.trim() || LOOPBACK_IP;
  if (isIP(ip) !== 4) {
    throw new Error(`invalid IPv4 bind address: ${value ?? ""}`);
  }
  return ip;
}

/**
 * A specific address is exposed in addition to loopback. The wildcard already
 * includes loopback, so it must be bound only once.
 */
export function bindHosts(ip: string): string[] {
  if (ip === LOOPBACK_IP || ip === ALL_IPV4_INTERFACES) return [ip];
  return [LOOPBACK_IP, ip];
}

/** Whether an active single-instance bridge satisfies a requested binding. */
export function bindingIncludes(
  activeIp: string | undefined,
  requestedIp: string,
): boolean {
  const active = normalizeBindIp(activeIp);
  return (
    requestedIp === LOOPBACK_IP ||
    active === ALL_IPV4_INTERFACES ||
    active === requestedIp
  );
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === LOOPBACK_IP || address === "::1" || address === `::ffff:${LOOPBACK_IP}`
  );
}

type ForwardedHeader = string | string[] | undefined;

function firstForwardedValue(value: ForwardedHeader): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",", 1)[0]?.trim() || undefined;
}

/** Trusts proxy client metadata only when the direct peer is loopback. */
export function effectiveClientAddress(
  peerAddress: string | undefined,
  forwardedFor: ForwardedHeader,
): string | undefined {
  if (!isLoopbackAddress(peerAddress)) return peerAddress;
  return firstForwardedValue(forwardedFor) ?? peerAddress;
}

/** Trusts the browser-facing WebSocket scheme only from a loopback proxy. */
export function websocketProtocol(
  peerAddress: string | undefined,
  forwardedProto: ForwardedHeader,
): "ws" | "wss" {
  return isLoopbackAddress(peerAddress) &&
    firstForwardedValue(forwardedProto)?.toLowerCase() === "https"
    ? "wss"
    : "ws";
}
