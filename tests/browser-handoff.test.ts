import assert from "node:assert/strict";
import test from "node:test";
import { BrowserHandoffRegistry } from "../src/bridge/browser-handoff.ts";

test("browser handoff tickets are single-use and retain the existing channel", () => {
  const channel = { process: "same-pi" };
  const registry = new BrowserHandoffRegistry<typeof channel>(1_000);
  const handoff = registry.create(channel, 100);

  assert.equal(registry.consume(handoff.ticket, 200), channel);
  assert.equal(registry.consume(handoff.ticket, 201), null);
});

test("browser handoff tickets expire without returning their channel", () => {
  const registry = new BrowserHandoffRegistry<object>(1_000);
  const handoff = registry.create({}, 100);
  assert.equal(registry.consume(handoff.ticket, 1_100), null);
});

test("closing a channel invalidates all of its pending handoffs", () => {
  const first = {};
  const second = {};
  const registry = new BrowserHandoffRegistry<object>(1_000);
  const firstTicket = registry.create(first, 100).ticket;
  const secondTicket = registry.create(second, 100).ticket;

  registry.removeChannel(first);
  assert.equal(registry.consume(firstTicket, 200), null);
  assert.equal(registry.consume(secondTicket, 200), second);
});
