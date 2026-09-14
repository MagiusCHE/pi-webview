import assert from "node:assert/strict";
import test from "node:test";

import {
  historyToolResultContent,
  imageDataUrl,
  imageDownloadName,
  toolExecutionEndContent,
} from "../src/ide/content-blocks.ts";

const jpeg = {
  type: "image" as const,
  mimeType: "image/jpeg",
  data: "/9j/example-jpeg-base64",
};
const png = {
  type: "image" as const,
  mimeType: "image/png",
  data: "iVBORw0KGgo-example-png-base64",
};

test("live tool_execution_end preserves mixed text and multiple image blocks", () => {
  const content = toolExecutionEndContent({
    type: "tool_execution_end",
    result: {
      content: [{ type: "text", text: "Generated two images." }, jpeg, png],
    },
  });

  assert.equal(content.text, "Generated two images.");
  assert.deepEqual(content.images, [jpeg, png]);
  assert.equal(content.text.includes(jpeg.data), false);
  assert.equal(content.text.includes(png.data), false);
});

test("resumed toolResult reconstructs JPEG/PNG images identically to live output", () => {
  const blocks = [
    { type: "text", text: "first" },
    jpeg,
    { type: "text", text: " + second" },
    png,
  ];
  const live = toolExecutionEndContent({ result: { content: blocks } });
  const resumed = historyToolResultContent({ role: "toolResult", content: blocks });

  assert.deepEqual(resumed, live);
  assert.equal(resumed.text, "first + second");
  assert.deepEqual(
    resumed.images.map((image) => image.mimeType),
    ["image/jpeg", "image/png"],
  );
});

test("image URLs and download names retain MIME data without exposing it as text", () => {
  assert.equal(imageDataUrl(jpeg), `data:image/jpeg;base64,${jpeg.data}`);
  assert.equal(imageDataUrl(png), `data:image/png;base64,${png.data}`);
  assert.equal(imageDownloadName(jpeg, 0), "pi-webview-image-1.jpg");
  assert.equal(imageDownloadName(png, 1), "pi-webview-image-2.png");
});

test("malformed and non-image blocks are ignored", () => {
  const content = historyToolResultContent({
    content: [
      { type: "text", text: "safe text" },
      { type: "image", mimeType: "text/html", data: "not-an-image" },
      { type: "image", mimeType: "image/png", data: "" },
      { type: "image", mimeType: "image/png" },
    ],
  });

  assert.deepEqual(content, {
    text: "safe text",
    images: [],
    items: [{ kind: "text", text: "safe text", format: "plain" }],
  });
});

test("JSON, fenced code, files and media get presentable typed items", () => {
  const content = historyToolResultContent({
    content: [
      { type: "text", text: '{"ok":true,"count":2}' },
      { type: "text", text: "```ts\nconst answer = 42;\n```" },
      {
        type: "file",
        name: "report.csv",
        mimeType: "text/csv",
        data: "YSxiXG4xLDI=",
      },
      {
        type: "audio",
        name: "answer.mp3",
        mimeType: "audio/mpeg",
        data: "YXVkaW8=",
      },
    ],
  });

  assert.deepEqual(content.items, [
    {
      kind: "text",
      text: '{\n  "ok": true,\n  "count": 2\n}',
      format: "json",
      language: "json",
    },
    {
      kind: "text",
      text: "const answer = 42;",
      format: "code",
      language: "ts",
    },
    {
      kind: "file",
      name: "report.csv",
      mimeType: "text/csv",
      data: "YSxiXG4xLDI=",
    },
    {
      kind: "media",
      mediaType: "audio",
      name: "answer.mp3",
      mimeType: "audio/mpeg",
      data: "YXVkaW8=",
    },
  ]);
});
