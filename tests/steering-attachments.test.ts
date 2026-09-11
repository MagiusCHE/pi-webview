import assert from "node:assert/strict";
import test from "node:test";
import {
  pairQueuedAttachments,
  SteeringAttachmentTracker,
  stripRestoredAttachmentMentions,
} from "../src/web/steering-attachments.ts";

interface Attachment {
  path: string;
  name: string;
}

const image = (name: string): Attachment => ({ path: `/tmp/${name}`, name });

test("queued steering retains image payload for clear_queue restoration", () => {
  const tracker = new SteeringAttachmentTracker<Attachment>();
  const attachment = image("diagram.png");
  const ticket = tracker.stage("inspect this", [attachment]);

  const queue = tracker.update(["inspect this"]);
  tracker.settle(ticket);

  assert.deepEqual(queue, [{ message: "inspect this", attachments: [attachment] }]);
  assert.deepEqual(pairQueuedAttachments(["inspect this"], tracker.snapshot()), queue);
});

test("queue reconciliation drops delivered head items and preserves duplicate order", () => {
  const tracker = new SteeringAttachmentTracker<Attachment>();
  const first = image("first.png");
  const second = image("second.png");

  tracker.stage("same", [first]);
  tracker.update(["same"]);
  tracker.stage("same", [second]);
  tracker.update(["same", "same"]);

  assert.deepEqual(tracker.update(["same"]), [
    { message: "same", attachments: [second] },
  ]);
});

test("queue ordering associates attachments after pi transforms message text", () => {
  const tracker = new SteeringAttachmentTracker<Attachment>();
  const attachment = image("prompt.png");
  tracker.stage("/template argument", [attachment]);

  assert.deepEqual(tracker.update(["Expanded template\n\nargument"]), [
    { message: "Expanded template\n\nargument", attachments: [attachment] },
  ]);
});

test("settled requests that were not queued cannot leak into later messages", () => {
  const tracker = new SteeringAttachmentTracker<Attachment>();
  const ticket = tracker.stage("handled elsewhere", [image("stale.png")]);
  tracker.settle(ticket);

  assert.deepEqual(tracker.update(["later"]), [{ message: "later", attachments: [] }]);
});

test("restored attachment markers become chips instead of composer text", () => {
  const attachment = image("notes.md");
  assert.equal(
    stripRestoredAttachmentMentions(
      "Review this\n\n[attachment: /tmp/notes.md]\n\nKeep details",
      [attachment],
    ),
    "Review this\n\nKeep details",
  );
  assert.equal(
    stripRestoredAttachmentMentions("[attachment: /tmp/unknown.md]", [attachment]),
    "[attachment: /tmp/unknown.md]",
  );
});
