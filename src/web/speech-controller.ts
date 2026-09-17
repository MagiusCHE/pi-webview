import type { SpeechInputMode } from "../ide/speech-config.ts";
import {
  transcriptFromRecognitionEvent,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionLike,
  type SpeechRuntime,
} from "./speech-to-text.ts";

export type SpeechControllerState = "idle" | "starting" | "listening" | "stopping";

export interface SpeechAudioTrack {
  stop(): void;
}

export interface SpeechMediaStream {
  getAudioTracks(): SpeechAudioTrack[];
}

export interface SpeechMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<SpeechMediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
}

export interface SpeechTimerScheduler {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SpeechStartOptions {
  mode: SpeechInputMode;
  language: string;
  /** Must be true only after the caller has verified a local model. */
  processLocally: boolean;
  /** Silence required before automatic submit in toggle-to-talk mode. */
  toggleSilenceMs: number;
  /** "default" delegates device choice to the browser/system. */
  inputDeviceId: "default" | string;
}

export type SpeechCompletionKind = "submitted" | "stopped" | "cancelled" | "error";

export interface SpeechCompletion {
  kind: SpeechCompletionKind;
  text: string;
}

export interface SpeechControllerCallbacks {
  onState(state: SpeechControllerState, mode: SpeechInputMode | null): void;
  onTranscript(finalText: string, interimText: string): void;
  /** Return false when the composer could not accept the completed segment. */
  onSubmit(text: string): boolean;
  onComplete(completion: SpeechCompletion): void;
  onError(code: string): void;
  onInputSelectionUnavailable?(): void;
}

const STOP_TIMEOUT_MS = 1_500;

function defaultTimerScheduler(): SpeechTimerScheduler {
  return {
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function joinSpeechParts(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function errorCode(event: SpeechRecognitionErrorEventLike): string {
  return event.error || event.message || "recognition-error";
}

function thrownErrorCode(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.name && error.name !== "Error" ? error.name : error.message || fallback;
}

/**
 * Browser-facing speech state machine. It never writes to the DOM or sends a
 * pi prompt itself, which keeps microphone lifecycle and send semantics testable.
 */
export class SpeechController {
  private state: SpeechControllerState = "idle";
  private mode: SpeechInputMode | null = null;
  private options: SpeechStartOptions | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  private stream: SpeechMediaStream | null = null;
  private sessionId = 0;
  private recognitionId = 0;
  private shouldListen = false;
  private submitOnEnd = false;
  private finalPrefix = "";
  private recognitionFinal = "";
  private recognitionInterim = "";
  private pauseTimer: unknown = null;
  private stopTimer: unknown = null;
  private readonly runtime: SpeechRuntime;
  private readonly callbacks: SpeechControllerCallbacks;
  private readonly mediaDevices: SpeechMediaDevices | undefined;
  private readonly timer: SpeechTimerScheduler;

  constructor(
    runtime: SpeechRuntime,
    callbacks: SpeechControllerCallbacks,
    mediaDevices: SpeechMediaDevices | undefined = typeof navigator !== "undefined"
      ? navigator.mediaDevices
      : undefined,
    timer: SpeechTimerScheduler = defaultTimerScheduler(),
  ) {
    this.runtime = runtime;
    this.callbacks = callbacks;
    this.mediaDevices = mediaDevices;
    this.timer = timer;
  }

  get currentState(): SpeechControllerState {
    return this.state;
  }

  get currentMode(): SpeechInputMode | null {
    return this.mode;
  }

  get active(): boolean {
    return this.state !== "idle";
  }

  /** Starts an explicit user-gesture speech session. */
  async start(options: SpeechStartOptions): Promise<boolean> {
    if (this.active) return false;
    const sessionId = ++this.sessionId;
    this.mode = options.mode;
    this.options = options;
    this.shouldListen = true;
    this.submitOnEnd = false;
    this.finalPrefix = "";
    this.recognitionFinal = "";
    this.recognitionInterim = "";
    this.setState("starting");

    try {
      if (this.mediaDevices) {
        const audio =
          options.inputDeviceId === "default"
            ? true
            : { deviceId: { exact: options.inputDeviceId } };
        const stream = await this.mediaDevices.getUserMedia({ audio });
        if (!this.isCurrent(sessionId) || !this.shouldListen) {
          this.stopTracks(stream);
          return false;
        }
        this.stream = stream;
      } else if (options.inputDeviceId !== "default") {
        throw new Error("input-selection-unavailable");
      }
      this.beginRecognition(sessionId);
      return this.active;
    } catch (error) {
      if (!this.isCurrent(sessionId)) return false;
      this.fail(thrownErrorCode(error, "microphone-unavailable"));
      return false;
    }
  }

  /** Completes a held push-to-talk session and sends its final segment once. */
  releasePushToTalk(): void {
    if (this.mode !== "push-to-talk" || !this.active) return;
    if (this.state === "starting") {
      this.finish("cancelled", "");
      return;
    }
    this.requestEnd(true, false);
  }

  /** Stops toggle mode without turning an unfinished segment into a prompt. */
  stopToggleToTalk(): void {
    if (this.mode !== "toggle-to-talk" || !this.active) return;
    if (this.state === "starting") {
      this.finish("cancelled", "");
      return;
    }
    this.requestEnd(false, false);
  }

  /** Used for blur, visibility loss, reload and capability loss: never auto-send. */
  stopSilently(): void {
    if (!this.active) return;
    if (this.state === "starting") {
      this.finish("cancelled", "");
      return;
    }
    this.requestEnd(false, false, true);
  }

  private beginRecognition(sessionId: number): void {
    if (!this.isCurrent(sessionId) || !this.shouldListen || !this.options) return;
    const options = this.options;
    const recognition = this.runtime.createRecognition();
    const recognitionId = ++this.recognitionId;
    this.recognition = recognition;

    recognition.lang = options.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    if (options.processLocally) {
      if (!("processLocally" in recognition)) {
        this.fail("local-recognition-unavailable");
        return;
      }
      recognition.processLocally = true;
    }

    recognition.onresult = (event) => {
      if (!this.isRecognitionCurrent(sessionId, recognitionId, recognition)) return;
      const transcript = transcriptFromRecognitionEvent(event);
      this.recognitionFinal = transcript.finalText;
      this.recognitionInterim = transcript.interimText;
      this.emitTranscript();
      if (this.mode === "toggle-to-talk" && this.shouldListen) this.armPauseTimer();
    };
    recognition.onerror = (event) => {
      if (!this.isRecognitionCurrent(sessionId, recognitionId, recognition)) return;
      const code = errorCode(event);
      // no-speech ends are normal in a continuous toggle session: onend below
      // restarts the recognizer while retaining any already-final text.
      if (code === "no-speech" && this.shouldListen) return;
      this.fail(code);
    };
    recognition.onend = () => {
      if (!this.isRecognitionCurrent(sessionId, recognitionId, recognition)) return;
      this.handleRecognitionEnd(sessionId, recognition);
    };

    try {
      const track = this.stream?.getAudioTracks()[0];
      if (track) {
        try {
          recognition.start(track as unknown as MediaStreamTrack);
        } catch (error) {
          if (options.inputDeviceId !== "default") {
            this.callbacks.onInputSelectionUnavailable?.();
            throw error;
          }
          // A legacy runtime may accept only its own default microphone. Do
          // not silently ignore an explicitly selected device, but permit the
          // default to use its native path.
          this.stopTracks(this.stream);
          this.stream = null;
          recognition.start();
        }
      } else {
        recognition.start();
      }
      this.setState("listening");
    } catch (error) {
      this.fail(thrownErrorCode(error, "recognition-start-failed"));
    }
  }

  private handleRecognitionEnd(
    sessionId: number,
    recognition: SpeechRecognitionLike,
  ): void {
    this.clearStopTimer();
    if (this.recognition === recognition) this.recognition = null;
    const text = this.completeText();
    const submit = this.submitOnEnd;
    const keepListening = this.shouldListen;
    this.submitOnEnd = false;

    if (submit) {
      const accepted = text ? this.callbacks.onSubmit(text) : false;
      this.resetSegment();
      if (!keepListening) {
        this.finish(accepted ? "submitted" : "stopped", text);
        return;
      }
      if (!accepted) {
        this.finish("stopped", text);
        return;
      }
      this.callbacks.onComplete({ kind: "submitted", text });
      this.setState("starting");
      void Promise.resolve().then(() => this.beginRecognition(sessionId));
      return;
    }

    if (keepListening) {
      // A browser can end a continuous recognizer after a short silence. Keep
      // its words and start another recognizer against the same live track.
      this.finalPrefix = text;
      this.recognitionFinal = "";
      this.recognitionInterim = "";
      this.emitTranscript();
      this.setState("starting");
      void Promise.resolve().then(() => this.beginRecognition(sessionId));
      return;
    }

    this.finish(text ? "stopped" : "cancelled", text);
  }

  private requestEnd(submit: boolean, continueListening: boolean, abort = false): void {
    this.clearPauseTimer();
    this.shouldListen = continueListening;
    this.submitOnEnd = submit;
    const recognition = this.recognition;
    if (!recognition) {
      const text = this.completeText();
      if (submit && text) {
        const accepted = this.callbacks.onSubmit(text);
        this.finish(accepted ? "submitted" : "stopped", text);
      } else {
        this.finish(text ? "stopped" : "cancelled", text);
      }
      return;
    }
    this.setState("stopping");
    try {
      if (abort) recognition.abort();
      else recognition.stop();
    } catch {
      const text = this.completeText();
      if (submit && text) {
        const accepted = this.callbacks.onSubmit(text);
        this.finish(accepted ? "submitted" : "stopped", text);
      } else {
        this.finish(text ? "stopped" : "cancelled", text);
      }
      return;
    }
    // Web Speech normally dispatches `end` asynchronously, but a compliant
    // shim may do it synchronously from stop()/abort(). Do not leave a stale
    // timeout behind after that terminal callback already settled the run.
    if (this.state === "stopping" && this.recognition === recognition) {
      this.armStopTimer();
    }
  }

  private armPauseTimer(): void {
    this.clearPauseTimer();
    const delay = this.options?.toggleSilenceMs ?? 1_500;
    this.pauseTimer = this.timer.setTimeout(() => {
      this.pauseTimer = null;
      if (
        this.mode === "toggle-to-talk" &&
        this.state === "listening" &&
        this.shouldListen
      ) {
        this.requestEnd(true, true);
      }
    }, delay);
  }

  private armStopTimer(): void {
    this.clearStopTimer();
    this.stopTimer = this.timer.setTimeout(() => {
      this.stopTimer = null;
      if (this.state !== "stopping") return;
      const text = this.completeText();
      const submit = this.submitOnEnd;
      const keepListening = this.shouldListen;
      this.submitOnEnd = false;
      if (submit && text) {
        const accepted = this.callbacks.onSubmit(text);
        this.resetSegment();
        if (keepListening && accepted) {
          this.callbacks.onComplete({ kind: "submitted", text });
          this.setState("starting");
          void Promise.resolve().then(() => this.beginRecognition(this.sessionId));
        } else {
          this.finish(accepted ? "submitted" : "stopped", text);
        }
      } else {
        this.finish(text ? "stopped" : "cancelled", text);
      }
    }, STOP_TIMEOUT_MS);
  }

  private fail(code: string): void {
    const text = this.completeText();
    this.callbacks.onError(code);
    this.finish("error", text);
  }

  private finish(kind: SpeechCompletionKind, text: string): void {
    this.clearPauseTimer();
    this.clearStopTimer();
    ++this.sessionId;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // The browser already ended it; cleanup continues.
      }
    }
    this.stopTracks(this.stream);
    this.stream = null;
    this.shouldListen = false;
    this.submitOnEnd = false;
    this.options = null;
    this.mode = null;
    this.finalPrefix = "";
    this.recognitionFinal = "";
    this.recognitionInterim = "";
    this.setState("idle");
    this.callbacks.onComplete({ kind, text });
  }

  private resetSegment(): void {
    this.finalPrefix = "";
    this.recognitionFinal = "";
    this.recognitionInterim = "";
    this.emitTranscript();
  }

  private completeText(): string {
    return joinSpeechParts(
      this.finalPrefix,
      this.recognitionFinal || this.recognitionInterim,
    );
  }

  private emitTranscript(): void {
    this.callbacks.onTranscript(
      joinSpeechParts(this.finalPrefix, this.recognitionFinal),
      this.recognitionInterim.trim(),
    );
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer !== null) this.timer.clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) this.timer.clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }

  private stopTracks(stream: SpeechMediaStream | null): void {
    for (const track of stream?.getAudioTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // A disconnected track is already closed.
      }
    }
  }

  private isCurrent(sessionId: number): boolean {
    return sessionId === this.sessionId;
  }

  private isRecognitionCurrent(
    sessionId: number,
    recognitionId: number,
    recognition: SpeechRecognitionLike,
  ): boolean {
    return (
      this.isCurrent(sessionId) &&
      recognitionId === this.recognitionId &&
      recognition === this.recognition
    );
  }

  private setState(state: SpeechControllerState): void {
    this.state = state;
    this.callbacks.onState(state, state === "idle" ? null : this.mode);
  }
}
