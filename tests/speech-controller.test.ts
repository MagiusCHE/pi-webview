import assert from "node:assert/strict";
import test from "node:test";
import {
  SpeechController,
  type SpeechAudioTrack,
  type SpeechCompletion,
  type SpeechControllerState,
  type SpeechMediaDevices,
  type SpeechTimerScheduler,
} from "../src/web/speech-controller.ts";
import type {
  SpeechRecognitionLike,
  SpeechRecognitionResultEventLike,
  SpeechRuntime,
} from "../src/web/speech-to-text.ts";

class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  processLocally: boolean | undefined;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null = null;
  onerror: ((event: { error?: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  startedWith: MediaStreamTrack | undefined;
  stopped = false;
  aborted = false;

  start(track?: MediaStreamTrack): void {
    this.startedWith = track;
  }

  stop(): void {
    this.stopped = true;
  }

  abort(): void {
    this.aborted = true;
  }

  result(finalText: string, interimText = ""): void {
    this.onresult?.({
      results: [
        ...(finalText ? [{ isFinal: true, 0: { transcript: finalText } }] : []),
        ...(interimText ? [{ isFinal: false, 0: { transcript: interimText } }] : []),
      ],
    });
  }

  end(): void {
    this.onend?.();
  }
}

class FakeTimer implements SpeechTimerScheduler {
  private nextId = 0;
  private callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  runNext(): void {
    const entry = this.callbacks.entries().next().value as
      [number, () => void] | undefined;
    if (!entry) return;
    this.callbacks.delete(entry[0]);
    entry[1]();
  }
}

function createHarness(onSubmit: (text: string) => boolean = () => true): {
  controller: SpeechController;
  recognitions: FakeRecognition[];
  states: SpeechControllerState[];
  transcripts: Array<[string, string]>;
  submissions: string[];
  completions: SpeechCompletion[];
  track: SpeechAudioTrack & { stopped: boolean };
  timer: FakeTimer;
} {
  const recognitions: FakeRecognition[] = [];
  const states: SpeechControllerState[] = [];
  const transcripts: Array<[string, string]> = [];
  const submissions: string[] = [];
  const completions: SpeechCompletion[] = [];
  const track: SpeechAudioTrack & { stopped: boolean } = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const mediaDevices: SpeechMediaDevices = {
    async getUserMedia() {
      return { getAudioTracks: () => [track] };
    },
    async enumerateDevices() {
      return [];
    },
  };
  const runtime: SpeechRuntime = {
    createRecognition() {
      const recognition = new FakeRecognition();
      recognitions.push(recognition);
      return recognition;
    },
  };
  const timer = new FakeTimer();
  const controller = new SpeechController(
    runtime,
    {
      onState: (state) => states.push(state),
      onTranscript: (finalText, interimText) =>
        transcripts.push([finalText, interimText]),
      onSubmit: (text) => {
        submissions.push(text);
        return onSubmit(text);
      },
      onComplete: (completion) => completions.push(completion),
      onError: () => undefined,
    },
    mediaDevices,
    timer,
  );
  return {
    controller,
    recognitions,
    states,
    transcripts,
    submissions,
    completions,
    track,
    timer,
  };
}

const PUSH_OPTIONS = {
  mode: "push-to-talk" as const,
  language: "it-IT",
  processLocally: true,
  toggleSilenceMs: 1500,
  inputDeviceId: "default" as const,
};

test("push-to-talk submits once on release and always cleans up its microphone track", async () => {
  const harness = createHarness();
  assert.equal(await harness.controller.start(PUSH_OPTIONS), true);
  const recognition = harness.recognitions[0]!;
  assert.equal(recognition.processLocally, true);
  assert.ok(recognition.startedWith);

  recognition.result("invia questo testo", "parziale");
  assert.deepEqual(harness.transcripts.at(-1), ["invia questo testo", "parziale"]);
  harness.controller.releasePushToTalk();
  assert.equal(recognition.stopped, true);
  recognition.end();

  assert.deepEqual(harness.submissions, ["invia questo testo"]);
  assert.deepEqual(harness.completions, [
    { kind: "submitted", text: "invia questo testo" },
  ]);
  assert.equal(harness.track.stopped, true);
  assert.equal(harness.states.at(-1), "idle");
});

test("a missing recognition end is bounded and still cleans up after push release", async () => {
  const harness = createHarness();
  await harness.controller.start(PUSH_OPTIONS);
  const recognition = harness.recognitions[0]!;
  recognition.result("timeout fallback");
  harness.controller.releasePushToTalk();
  harness.timer.runNext();

  assert.deepEqual(harness.submissions, ["timeout fallback"]);
  assert.deepEqual(harness.completions, [
    { kind: "submitted", text: "timeout fallback" },
  ]);
  assert.equal(harness.track.stopped, true);
  assert.equal(harness.controller.active, false);
});

test("silent interruption never submits partial speech", async () => {
  const harness = createHarness();
  await harness.controller.start(PUSH_OPTIONS);
  const recognition = harness.recognitions[0]!;
  recognition.result("do not send");
  harness.controller.stopSilently();
  recognition.end();

  assert.deepEqual(harness.submissions, []);
  assert.deepEqual(harness.completions, [{ kind: "stopped", text: "do not send" }]);
  assert.equal(harness.track.stopped, true);
});

test("toggle-to-talk sends after silence and starts a new segment only after acceptance", async () => {
  const harness = createHarness();
  await harness.controller.start({ ...PUSH_OPTIONS, mode: "toggle-to-talk" });
  const first = harness.recognitions[0]!;
  first.result("first segment");
  harness.timer.runNext();
  assert.equal(first.stopped, true);
  first.end();
  await Promise.resolve();

  assert.deepEqual(harness.submissions, ["first segment"]);
  assert.deepEqual(harness.completions, [{ kind: "submitted", text: "first segment" }]);
  assert.equal(harness.recognitions.length, 2);
  harness.controller.stopToggleToTalk();
  harness.recognitions[1]!.end();
});

test("toggle-to-talk stops rather than continuing when the composer rejects a segment", async () => {
  const harness = createHarness(() => false);
  await harness.controller.start({ ...PUSH_OPTIONS, mode: "toggle-to-talk" });
  const first = harness.recognitions[0]!;
  first.result("unaccepted");
  harness.timer.runNext();
  first.end();
  await Promise.resolve();

  assert.deepEqual(harness.submissions, ["unaccepted"]);
  assert.deepEqual(harness.completions, [{ kind: "stopped", text: "unaccepted" }]);
  assert.equal(harness.recognitions.length, 1);
  assert.equal(harness.controller.active, false);
});
