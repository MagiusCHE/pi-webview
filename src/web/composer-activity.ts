export interface ComposerActivityState {
  agentActive: boolean;
  working: boolean;
}

export type ComposerActivityEvent =
  | "agent_start"
  | "turn_start"
  | "agent_settled"
  | "compaction_start"
  | "compaction_end"
  | "abort"
  | "connection_closed";

/** Keep composer steering active across automatic compaction continuations. */
export function transitionComposerActivity(
  state: ComposerActivityState,
  event: ComposerActivityEvent,
): ComposerActivityState {
  switch (event) {
    case "agent_start":
    case "turn_start":
      return { agentActive: true, working: true };
    case "compaction_start":
      return { ...state, working: true };
    case "compaction_end":
      return { ...state, working: state.agentActive };
    case "agent_settled":
    case "abort":
    case "connection_closed":
      return { agentActive: false, working: false };
  }
}
