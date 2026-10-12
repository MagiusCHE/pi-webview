import {
  AGENT_STOP_ENTRY_DATA,
  AGENT_STOP_ENTRY_TYPE,
} from "../../../src/ide/agent-stop.ts";

export interface AgentStopPiApi {
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => void | Promise<void>,
  ): void;
  appendEntry(customType: string, data: unknown): void;
}

export function registerAgentStopPersistence(pi: AgentStopPiApi): void {
  pi.on("agent_settled", (event) => {
    if ((event as { aborted?: unknown } | null)?.aborted !== true) return;
    // Aborting a tool batch need not produce an aborted assistant message.
    // Metadata survives reload/fork without adding instructions to model context.
    pi.appendEntry(AGENT_STOP_ENTRY_TYPE, AGENT_STOP_ENTRY_DATA);
  });
}
