import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type {
  DesktopApp,
  NativeAction,
  NativeDriver,
  NativeSnapshot,
  Permissions,
} from "../shared/types.js";
import { LocalOCR } from "./ocr.js";

export class PlatformDriver implements NativeDriver {
  private child?: ChildProcessWithoutNullStreams;
  private captureDirectory?: string;
  private ocr = new LocalOCR();
  private epoch = 0;
  private ocrTargets = new Map<
    string,
    { snapshotId: string; point: { x: number; y: number } }
  >();
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private resourcePath: string,
    private packaged: boolean,
  ) {}

  private boot() {
    if (this.child) return this.child;
    const path = this.packaged
      ? join(this.resourcePath, "native")
      : join(
          this.resourcePath,
          "desktop/native",
          process.platform === "darwin" ? "macos" : "windows",
        );
    let command: string;
    let args: string[];
    if (process.platform === "darwin") {
      command = join(path, "otto-ax");
      args = [];
    } else if (process.platform === "win32") {
      command = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      args = [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Mta",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(path, "otto-uia.ps1"),
      ];
    } else throw new Error("Otto supports macOS and Windows.");
    const captureDirectory = mkdtempSync(join(tmpdir(), "otto-capture-"));
    this.captureDirectory = captureDirectory;
    const child = spawn(command, args, {
      windowsHide: true,
      detached: process.platform === "darwin",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        OTTO_PARENT_PID: String(process.pid),
        OTTO_CAPTURE_DIR: captureDirectory,
      },
    });
    this.child = child;
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      if (line.length > 16_000_000) {
        this.cancel();
        return;
      }
      let response: {
        id?: string;
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      try {
        response = JSON.parse(line);
      } catch {
        this.cancel();
        return;
      }
      const pending = response.id ? this.pending.get(response.id) : undefined;
      if (!pending) return;
      this.pending.delete(response.id!);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response.result);
      else
        pending.reject(
          new Error(
            typeof response.error === "string"
              ? response.error.slice(0, 300)
              : "The native helper failed.",
          ),
        );
    });
    // Native diagnostics may contain selected-app content. Never forward them into telemetry or renderer logs.
    child.stderr.on("data", () => undefined);
    const ended = () => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.captureDirectory === captureDirectory)
        this.captureDirectory = undefined;
      rmSync(captureDirectory, { recursive: true, force: true });
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(
          new Error("Native control stopped. Start a new task to reconnect."),
        );
      }
      this.pending.clear();
    };
    child.once("error", ended);
    child.once("exit", ended);
    return child;
  }

  request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const child = this.boot();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timeout after an OS event is ambiguous. Terminate rather than retry.
        this.cancel();
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.stdin.write(JSON.stringify({ id, op, ...args }) + "\n", (error) => {
        if (error) this.cancel();
      });
    });
  }
  apps() {
    return this.request<{ apps: DesktopApp[]; permissions: Permissions }>(
      "apps",
    );
  }
  permissions() {
    return this.request<Permissions>("permissions");
  }
  requestPermission(kind: "accessibility" | "screenCapture") {
    return this.request<Permissions>("requestPermission", { kind });
  }
  async configure(appIds: string[]) {
    await this.request("configure", { appIds });
  }
  async observe(appId: string) {
    const epoch = this.epoch;
    const snapshot = await this.request<NativeSnapshot>("observe", { appId });
    if (this.epoch !== epoch) throw new Error("Observation cancelled.");
    this.ocrTargets.clear();
    try {
      let timeout: NodeJS.Timeout | undefined;
      const extra = await Promise.race([
        this.ocr.controls(snapshot),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            void this.ocr.close();
            reject(new Error("Local OCR timed out."));
          }, 8_000);
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
      if (this.epoch !== epoch) throw new Error("Observation cancelled.");
      for (const control of extra) {
        const bounds = control.bounds!;
        this.ocrTargets.set(control.id, {
          snapshotId: snapshot.snapshotId,
          point: {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
          },
        });
      }
      snapshot.controls.push(...extra);
    } catch {
      if (this.epoch !== epoch) throw new Error("Observation cancelled.");
      // Native accessibility still works when local OCR cannot read the window.
    }
    return snapshot;
  }
  async act(action: NativeAction) {
    const ocr = action.targetId
      ? this.ocrTargets.get(action.targetId)
      : undefined;
    if (action.targetId?.startsWith("ocr-")) {
      if (
        !ocr ||
        ocr.snapshotId !== action.snapshotId ||
        action.kind !== "press"
      )
        throw new Error("The OCR target expired. Observe the app again.");
      this.ocrTargets.clear();
      await this.request("act", {
        action: { ...action, kind: "click", point: ocr.point },
      });
    } else await this.request("act", { action });
  }
  cancel() {
    this.epoch++;
    this.ocrTargets.clear();
    void this.ocr.close();
    const child = this.child;
    this.child = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        new Error(
          "Native control stopped. No further action will be dispatched.",
        ),
      );
    }
    this.pending.clear();
    if (child) {
      try {
        if (process.platform === "darwin" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    if (this.captureDirectory) {
      rmSync(this.captureDirectory, { recursive: true, force: true });
      this.captureDirectory = undefined;
    }
  }
}
