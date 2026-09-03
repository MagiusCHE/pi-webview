import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_IPV4_INTERFACES,
  LOOPBACK_IP,
  bindHosts,
  bindingIncludes,
  effectiveClientAddress,
  isLoopbackAddress,
  normalizeBindIp,
  websocketProtocol,
} from "../src/bridge/bind.ts";

test("bind defaults to IPv4 loopback", () => {
  assert.equal(normalizeBindIp(), LOOPBACK_IP);
  assert.deepEqual(bindHosts(LOOPBACK_IP), [LOOPBACK_IP]);
});

test("a specific IPv4 address is bound together with loopback", () => {
  assert.deepEqual(bindHosts("192.168.1.20"), [LOOPBACK_IP, "192.168.1.20"]);
});

test("the IPv4 wildcard is bound once and includes loopback", () => {
  assert.deepEqual(bindHosts(ALL_IPV4_INTERFACES), [ALL_IPV4_INTERFACES]);
  assert.equal(bindingIncludes(ALL_IPV4_INTERFACES, "192.168.1.20"), true);
});

test("an active specific binding only includes itself and loopback", () => {
  assert.equal(bindingIncludes("192.168.1.20", LOOPBACK_IP), true);
  assert.equal(bindingIncludes("192.168.1.20", "192.168.1.20"), true);
  assert.equal(bindingIncludes("192.168.1.20", "192.168.1.21"), false);
});

test("invalid and IPv6 bind addresses are rejected", () => {
  assert.throws(() => normalizeBindIp("localhost"), /invalid IPv4/);
  assert.throws(() => normalizeBindIp("::1"), /invalid IPv4/);
});

test("IPv4 and mapped loopback peers are recognized", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.10"), false);
});

test("forwarded client addresses are trusted only from a loopback proxy", () => {
  assert.equal(effectiveClientAddress("127.0.0.1", "100.64.0.10"), "100.64.0.10");
  assert.equal(
    effectiveClientAddress("::ffff:127.0.0.1", "100.64.0.10, 127.0.0.1"),
    "100.64.0.10",
  );
  assert.equal(effectiveClientAddress("192.168.1.10", "127.0.0.1"), "192.168.1.10");
});

test("forwarded HTTPS is trusted only from a loopback proxy", () => {
  assert.equal(websocketProtocol("127.0.0.1", "https"), "wss");
  assert.equal(websocketProtocol("::ffff:127.0.0.1", "HTTPS, http"), "wss");
  assert.equal(websocketProtocol("127.0.0.1", "http"), "ws");
  assert.equal(websocketProtocol("192.168.1.10", "https"), "ws");
  assert.equal(websocketProtocol(undefined, undefined), "ws");
});
