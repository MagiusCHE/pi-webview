import assert from "node:assert/strict";
import test from "node:test";
import { formatAskUserQuestion, parseAskUserQuestions } from "../src/web/ask-user.ts";

test("ask_user keeps option labels and descriptions in the persistent card", () => {
  const questions = parseAskUserQuestions(
    JSON.stringify({
      questions: [
        {
          question: "How should the release proceed?",
          options: [
            { label: "Publish now", description: "Publish all artifacts" },
            { label: "Wait", description: "Keep the release as a draft" },
          ],
        },
      ],
    }),
  );
  assert.ok(questions);
  assert.equal(
    formatAskUserQuestion(questions[0]!, "Options"),
    "How should the release proceed?\n\nOptions:\n1. Publish now — Publish all artifacts\n2. Wait — Keep the release as a draft",
  );
});

test("ask_user supports string options and multiple questions", () => {
  const questions = parseAskUserQuestions(
    JSON.stringify({
      questions: [
        { question: "First?", options: ["One", "Two"] },
        { question: "Second?", options: [] },
      ],
    }),
  );
  assert.deepEqual(questions, [
    {
      question: "First?",
      options: [{ label: "One" }, { label: "Two" }],
    },
    { question: "Second?", options: [] },
  ]);
  assert.equal(formatAskUserQuestion(questions![1]!, "Options"), "Second?");
});

test("ask_user accepts a single question object and rejects malformed JSON", () => {
  assert.deepEqual(
    parseAskUserQuestions(
      JSON.stringify({
        question: "Choose",
        options: [{ value: "fallback-label" }, null],
      }),
    ),
    [{ question: "Choose", options: [{ label: "fallback-label" }] }],
  );
  assert.equal(parseAskUserQuestions("{"), null);
});
