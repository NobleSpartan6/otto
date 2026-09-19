import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

type VoiceResult = { text: string };
type VoiceStart = { status: "listening" | "unavailable"; message?: string };
export const VOICE_START_TIMEOUT_MS = 60_000;
export const VOICE_CAPTURE_TIMEOUT_MS = 45_000;
export const VOICE_STOP_TIMEOUT_MS = 5_000;

/** One short, local dictation session. No audio or transcript is persisted. */
export class VoiceSession {
  private child?: ChildProcessWithoutNullStreams;
  private result?: Promise<VoiceResult>;
  private cancelResult?: () => void;
  private stopResult?: () => void;
  private starting = false;
  private generation = 0;
  private closed?: Promise<void>;
  get isActive() { return this.starting || Boolean(this.child); }
  constructor(private resources: string, private packaged: boolean,
    private options: { spawn?: typeof spawn; platform?: NodeJS.Platform; onEnd?: (event: { cancelled: boolean }) => void } = {}) {}

  async start(): Promise<VoiceStart> {
    if (this.starting || this.child) throw new Error("Dictation is already active or stopping.");
    this.result = undefined;
    this.generation++;
    const generation = this.generation;
    this.starting = true;
    const platform = this.options.platform ?? process.platform;
    const native = this.packaged ? join(this.resources, "native") : join(this.resources, "desktop/native");
    let command: string;
    let args: string[];
    if (platform === "darwin") {
      command = join(native, this.packaged ? "otto-voice" : "macos/otto-voice"); args = [];
    } else if (platform === "win32") {
      command = join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
      args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        join(native, this.packaged ? "otto-voice.ps1" : "windows/otto-voice.ps1")];
    } else {
      this.starting = false;
      return { status: "unavailable", message: "Native dictation is available on macOS and Windows." };
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = (this.options.spawn ?? spawn)(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP, TMP: process.env.TMP, LANG: process.env.LANG } });
    } catch {
      this.starting = false;
      return { status: "unavailable", message: "The native dictation helper could not start." };
    }
    this.child = child;
    let resolveClosed!: () => void;
    this.closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    return new Promise<VoiceStart>(resolveStart => {
      let ready = false;
      let ended = false;
      let stopping = false;
      let buffer = "";
      let outcome: { text: string; error?: string } = { text: "" };
      let resolveResult!: (result: VoiceResult) => void;
      let rejectResult!: (reason: Error) => void;
      let captureTimer: ReturnType<typeof setTimeout> | undefined;
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      this.result = new Promise<VoiceResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
      void this.result.catch(() => undefined);
      const finish = (text = "", error?: string) => {
        if (ended) return;
        ended = true;
        outcome = { text, error };
        buffer = "";
        clearTimeout(startupTimer); clearTimeout(captureTimer); clearTimeout(stopTimer);
        if (!ready) resolveStart({ status: "unavailable", message: error ?? "Dictation was cancelled." });
        // Keep the active slot until close confirms this process cannot record.
        try { child.kill("SIGKILL"); } catch { /* The close/error path still owns teardown. */ }
      };
      const startupTimer = setTimeout(() => finish("", "Dictation could not start. Check microphone and speech permissions, then try again."), VOICE_START_TIMEOUT_MS);
      this.cancelResult = () => { outcome = { text: "" }; finish(); };
      this.stopResult = () => {
        if (ended || stopping) return;
        stopping = true;
        // A stop during permissions/startup must not later open the microphone.
        if (!ready) { finish(); return; }
        stopTimer = setTimeout(() => finish("", "Dictation could not finish. Try again or type your task."), VOICE_STOP_TIMEOUT_MS);
        try { child.stdin.write("stop\n", error => { if (error) finish("", "Dictation stopped before returning a transcript."); }); }
        catch { finish("", "Dictation stopped before returning a transcript."); }
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (ended) return;
        if (buffer.length + chunk.length > 32_000) { finish("", "Dictation returned too much text. Try a shorter task."); return; }
        buffer += chunk;
        let newline: number;
        while (!ended && (newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const value: unknown = JSON.parse(line);
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
            const message = value as Record<string, unknown>;
            if (message.event === "listening" && !ready && Object.keys(message).length === 1) {
              ready = true; this.starting = false; clearTimeout(startupTimer);
              captureTimer = setTimeout(() => finish("", "Dictation timed out. Try a shorter task."), VOICE_CAPTURE_TIMEOUT_MS);
              resolveStart({ status: "listening" });
            } else if (message.event === "result" && ready && Object.keys(message).length === 2 && typeof message.text === "string" && message.text.length <= 4000 && !message.text.includes("\0")) {
              finish(message.text);
            } else if (message.event === "error" && Object.keys(message).length === 2 && typeof message.message === "string") {
              // Helpers emit only authored static errors. Never relay stderr or OS exceptions.
              finish("", message.message.slice(0, 300));
            } else finish("", "Dictation returned an invalid response.");
          } catch { finish("", "Dictation returned an invalid response."); }
        }
      });
      child.stdin.on("error", () => finish("", "Dictation stopped before returning a transcript."));
      child.stdout.on("error", () => finish("", "Dictation stopped before returning a transcript."));
      child.stderr.on("error", () => undefined);
      child.stderr.resume();
      child.once("error", () => finish("", "The native dictation helper could not start."));
      // close follows stdout drainage; exit alone can race the final JSON frame.
      child.once("close", () => {
        if (!ended) finish("", "Dictation stopped before returning a transcript.");
        if (this.child === child) {
          this.child = undefined; this.starting = false; this.cancelResult = undefined; this.stopResult = undefined;
        }
        if (outcome.error) rejectResult(new Error(outcome.error)); else resolveResult({ text: outcome.text });
        outcome = { text: "" };
        resolveClosed();
        try { this.options.onEnd?.({ cancelled: generation !== this.generation }); } catch { /* Capture is closed even if the UI has gone away. */ }
      });
    });
  }

  async stop(): Promise<VoiceResult> {
    const result = this.result;
    const generation = this.generation;
    if (!result) throw new Error("Start dictation first.");
    this.stopResult?.();
    try { const transcript = await result; return generation === this.generation ? transcript : { text: "" }; }
    catch (error) { if (generation !== this.generation) return { text: "" }; throw error; }
    finally { if (this.result === result) this.result = undefined; }
  }
  cancel(): Promise<void> {
    this.generation++;
    this.cancelResult?.();
    this.result = undefined;
    return this.closed ?? Promise.resolve();
  }
}
