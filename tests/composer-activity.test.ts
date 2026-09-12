import assert from "node:assert/strict";
import test from "node:test";
import {
  transitionComposerActivity,
  type ComposerActivityState,
} from "../src/web/composer-activity.ts";

function transition(
  initial: ComposerActivityState,
  ...events: Parameters<typeof transitionComposerActivity>[1][]
): ComposerActivityState {
  return events.reduce(transitionComposerActivity, initial);
}

test("automatic compaction preserves steering and STOP for the active agent", () => {
  assert.deepEqual(
    transition(
      { agentActive: false, working: false },
      "agent_start",
      "compaction_start",
      "compaction_end",
      "turn_start",
    ),
    { agentActive: true, working: true },
  );
});

test("an idle manual compaction unlocks the composer when it finishes", () => {
  assert.deepEqual(
    transition(
      { agentActive: false, working: false },
      "compaction_start",
      "compaction_end",
    ),
    { agentActive: false, working: false },
  );
});

test("agent settlement, abort and disconnect clear composer activity", () => {
  const active = { agentActive: true, working: true };
  for (const event of ["agent_settled", "abort", "connection_closed"] as const) {
    assert.deepEqual(transitionComposerActivity(active, event), {
      agentActive: false,
      working: false,
    });
  }
});
