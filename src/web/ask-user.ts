export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  question: string;
  options: AskUserOption[];
}

function printableValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function parseOption(value: unknown): AskUserOption | null {
  if (typeof value === "string") {
    return value.length > 0 ? { label: value } : null;
  }
  if (!value || typeof value !== "object") return null;
  const option = value as Record<string, unknown>;
  const label =
    typeof option.label === "string"
      ? option.label
      : typeof option.value === "string"
        ? option.value
        : printableValue(value);
  if (!label) return null;
  return {
    label,
    ...(typeof option.description === "string" && option.description.length > 0
      ? { description: option.description }
      : {}),
  };
}

export function parseAskUserQuestions(argsJson: string): AskUserQuestion[] | null {
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    const raw = Array.isArray((parsed as { questions?: unknown })?.questions)
      ? ((parsed as { questions: unknown[] }).questions as unknown[])
      : parsed && typeof parsed === "object"
        ? [parsed]
        : [];
    if (raw.length === 0) return null;
    return raw.map((value): AskUserQuestion => {
      const question =
        value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const options = Array.isArray(question.options)
        ? question.options
            .map((option) => parseOption(option))
            .filter((option): option is AskUserOption => option !== null)
        : [];
      return {
        question:
          typeof question.question === "string"
            ? question.question
            : printableValue(value),
        options,
      };
    });
  } catch {
    return null;
  }
}

export function formatAskUserQuestion(
  question: AskUserQuestion,
  optionsHeading: string,
): string {
  if (question.options.length === 0) return question.question;
  const options = question.options.map((option, index) => {
    const description = option.description ? ` — ${option.description}` : "";
    return `${index + 1}. ${option.label}${description}`;
  });
  return `${question.question}\n\n${optionsHeading}:\n${options.join("\n")}`;
}
