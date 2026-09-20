import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, readdirSync, unlinkSync, rmdirSync, lstatSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export class AgentLeaseBusyError extends Error {
  readonly code = "desktop_busy";
  constructor() {
    super("Another Otto MCP client owns desktop control. Wait, then retry Otto. Do not fall back to another computer-use executor while it is busy.");
    this.name = "AgentLeaseBusyError";
  }
}
export class AgentLeaseUnavailableError extends Error {
  readonly code = "desktop_unavailable";
  constructor() {
    super("Otto cannot access its local desktop-control lease. Check local filesystem access and retry only after fixing it. Do not bypass coordination with another computer-use executor.");
    this.name = "AgentLeaseUnavailableError";
  }
}

export interface AgentLeaseOptions { directory?: string; idleMs?: number }
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
};
const ownerPid = (name: string) => {
  const match = /^owner-([1-9][0-9]*)-[0-9a-f-]{36}\.json$/.exec(name);
  const pid = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
};

/** Coordinates Otto agent-server processes only, not Electron or other CUA tools. */
export class AgentLease {
  private readonly directory: string;
  private readonly lock: string;
  private readonly marker = `owner-${process.pid}-${randomUUID()}.json`;
  private readonly idleMs: number;
  private held = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(options: AgentLeaseOptions = {}) {
    this.directory = options.directory ?? join(homedir(), ".otto", "agent-control", createHash("sha256").update(hostname()).digest("hex").slice(0, 16));
    this.lock = join(this.directory, "desktop.lock");
    this.idleMs = options.idleMs ?? 30_000;
    if (!Number.isSafeInteger(this.idleMs) || this.idleMs < 1 || this.idleMs > 30_000) throw new Error("Invalid Otto lease idle duration.");
  }

  acquire(): void {
    this.clearTimer();
    let renameDenied = false;
    if (this.held) {
      try {
        const entries = this.entries();
        if (entries.length === 1 && entries[0] === this.marker) return;
      } catch (error) {
        this.held = false;
        if (errorCode(error) !== "ENOENT") throw new AgentLeaseUnavailableError();
      }
      this.held = false;
      throw new AgentLeaseBusyError();
    }
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      for (let attempt = 0; attempt < 3; attempt++) {
        // The final lock is never initialized empty. A crashed contender leaves
        // only an unreferenced staging directory, never a half-written lease.
        const stage = join(this.directory, `pending-${randomUUID()}`);
        mkdirSync(stage, { mode: 0o700 });
        try {
          writeFileSync(join(stage, this.marker), JSON.stringify({ pid: process.pid, owner: this.marker, startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
          // Windows can replace a regular file with a renamed directory.
          // Reject foreign path types before attempting the atomic lease claim.
          try {
            const destination = lstatSync(this.lock);
            if (!destination.isDirectory() || destination.isSymbolicLink()) throw new AgentLeaseUnavailableError();
          } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
          try {
            renameSync(stage, this.lock);
            this.held = true;
            return;
          } catch (error) {
            // Windows may use EPERM for an existing nonempty destination;
            // inspect that destination below before treating it as contention.
            if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(errorCode(error) ?? "")) throw new AgentLeaseUnavailableError();
            renameDenied = errorCode(error) === "EPERM";
          }
        } finally {
          try { unlinkSync(join(stage, this.marker)); } catch { /* renamed or absent */ }
          try { rmdirSync(stage); } catch { /* renamed or absent */ }
        }
        if (!this.reclaimDeadOwner()) throw new AgentLeaseBusyError();
      }
    } catch (error) {
      if (error instanceof AgentLeaseBusyError || error instanceof AgentLeaseUnavailableError) throw error;
      throw new AgentLeaseUnavailableError();
    }
    if (renameDenied) throw new AgentLeaseUnavailableError();
    throw new AgentLeaseBusyError();
  }

  /** Call only once native work has settled; active work has no stealable TTL. */
  idle(onExpire: () => void): void {
    this.clearTimer();
    if (!this.held) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try { onExpire(); } catch { /* Expiry must still attempt release. */ }
      try { this.release(); } catch { /* Keep failed ownership reserved, without an uncaught timer error. */ }
    }, this.idleMs);
    this.timer.unref();
  }

  release(): void {
    this.clearTimer();
    if (!this.held) return;
    // Remove only our unique marker; never recursively remove another owner.
    try { unlinkSync(join(this.lock, this.marker)); }
    catch (error) {
      if (errorCode(error) === "ENOENT") { this.held = false; return; }
      throw new AgentLeaseUnavailableError();
    }
    this.held = false;
    try { rmdirSync(this.lock); }
    catch (error) {
      // A new prepared lease may already occupy the path.
      if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "")) throw new AgentLeaseUnavailableError();
    }
  }

  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private entries(): string[] {
    const stat = lstatSync(this.lock);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AgentLeaseUnavailableError();
    return readdirSync(this.lock);
  }
  private reclaimDeadOwner(): boolean {
    let entries: string[];
    try { entries = this.entries(); }
    catch (error) {
      if (errorCode(error) === "ENOENT") return true; // The previous owner released during acquisition.
      throw new AgentLeaseUnavailableError();
    }
    if (entries.length === 0) {
      // Windows cannot rename a prepared lease over an existing directory,
      // even when empty. Recover an interrupted release without recursion;
      // a replacement owner's nonempty directory cannot be removed here.
      try { rmdirSync(this.lock); return true; }
      catch (error) {
        if (errorCode(error) === "ENOENT") return true;
        if (["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "")) return false;
        throw new AgentLeaseUnavailableError();
      }
    }
    if (entries.length !== 1) return false;
    const marker = entries[0]!;
    const pid = ownerPid(marker);
    if (!pid || alive(pid)) return false;
    // Renaming the unique dead marker arbitrates concurrent reapers. The new
    // marker identifies this live reaper, so nobody can reclaim it mid-cleanup.
    const reaping = `owner-${process.pid}-${randomUUID()}.json`;
    try { renameSync(join(this.lock, marker), join(this.lock, reaping)); }
    catch (error) {
      if (errorCode(error) === "ENOENT") return false; // Another reaper won.
      throw new AgentLeaseUnavailableError();
    }
    try { unlinkSync(join(this.lock, reaping)); }
    catch { throw new AgentLeaseUnavailableError(); }
    try { rmdirSync(this.lock); }
    catch (error) {
      // A contender may atomically replace the now-empty directory.
      if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "")) throw new AgentLeaseUnavailableError();
    }
    return true;
  }
}
