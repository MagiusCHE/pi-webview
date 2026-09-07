export type AgenticMetric = "thought" | "read" | "write" | "bash" | "tools";

export interface AgenticCounts {
  thought: number;
  read: number;
  write: number;
  bash: number;
  tools: number;
}

export const emptyAgenticCounts = (): AgenticCounts => ({
  thought: 0,
  read: 0,
  write: 0,
  bash: 0,
  tools: 0,
});

/** Maps concrete tool names to the compact categories shown in the header. */
export function agenticToolMetric(name: string): Exclude<AgenticMetric, "thought"> {
  switch (name.toLowerCase()) {
    case "read":
      return "read";
    case "write":
    case "edit":
    case "edit-diff":
      return "write";
    case "bash":
      return "bash";
    default:
      return "tools";
  }
}
