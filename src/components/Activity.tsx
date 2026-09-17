import {
  Check,
  CircleAlert,
  Download,
  File,
  LoaderCircle,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useState } from "react";
import { errorMessage, isActive, nativeAPI, type OttoRun } from "../api";

const labels: Record<OttoRun["status"], string> = {
  running: "Working",
  awaiting_approval: "Your approval",
  awaiting_confirmation: "Review result",
  completed: "Confirmed complete",
  stopped: "Stopped",
  failed: "Needs attention",
  limit_reached: "Step limit reached",
  blocked: "Blocked",
};

export function Activity({
  run,
  busy,
  native,
  platform,
  onApprove,
  onConfirm,
  onStop,
}: {
  run: OttoRun | null;
  busy: boolean;
  native: boolean;
  platform?: string;
  onApprove: () => void;
  onConfirm: () => void;
  onStop: () => void;
}) {
  const [exportError, setExportError] = useState("");
  async function download() {
    if (!run) return;
    try {
      setExportError("");
      await nativeAPI().exportRun(run.id);
    } catch (cause) {
      setExportError(errorMessage(cause, "Unable to export the trace."));
    }
  }
  return (
    <section className="activity-panel" aria-labelledby="activity-heading">
      <div className="activity-heading">
        <h2 id="activity-heading">Activity</h2>
        <div className="activity-tools">
          {run && (
            <>
              <span className={`run-status status-${run.status}`}>
                <span />
                {labels[run.status]}
              </span>
              <button
                className="icon-button"
                onClick={download}
                aria-label="Download run trace"
              >
                <Download size={17} />
              </button>
            </>
          )}
          {native && (
            <>
              <button
                className="header-stop"
                disabled={!isActive(run)}
                onClick={onStop}
              >
                <Square size={12} fill="currentColor" />
                Stop task
              </button>
              <kbd className="stop-shortcut" title="Emergency stop shortcut">
                {platform === "win32" ? "Ctrl ⇧ ⌫" : "⌘ ⇧ ⌫"}
              </kbd>
            </>
          )}
        </div>
      </div>
      {!run ? (
        <div className="empty-activity">
          <File size={30} strokeWidth={1.4} />
          <p>
            {native ? "No actions yet." : "Your next good idea starts here."}
          </p>
        </div>
      ) : (
        <>
          <div className="run-progress">
            <span>{run.goal}</span>
            <span>
              Step {run.step} / {run.maxSteps}
            </span>
          </div>
          {run.events.length > 0 && (
            <ol className="event-list" aria-label="Task activity">
              {run.events.map((event) => (
                <li key={event.id}>
                  <span
                    className={`event-dot event-${event.kind}`}
                    aria-hidden="true"
                  >
                    {event.kind === "error" ? (
                      <CircleAlert size={15} />
                    ) : event.kind === "completed" ||
                      event.kind === "action" ? (
                      <Check size={14} />
                    ) : (
                      <span />
                    )}
                  </span>
                  <div>
                    <p>{event.message}</p>
                    <div className="event-meta">
                      <time dateTime={event.timestamp}>
                        {new Date(event.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                      {typeof event.confidence === "number" && (
                        <span>
                          {Math.round(
                            event.confidence <= 1
                              ? event.confidence * 100
                              : event.confidence,
                          )}
                          % confidence
                        </span>
                      )}
                      {typeof event.latencyMs === "number" && (
                        <span>{(event.latencyMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {run.status === "awaiting_approval" && run.pendingAction && (
            <div className="approval-panel" role="status">
              <ShieldCheck size={22} />
              <div>
                <h3>{run.pendingAction.label}</h3>
                <p>{run.pendingAction.reason}</p>
                <div className="approval-buttons">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={onApprove}
                  >
                    {busy ? "Please wait…" : "Approve action"}
                    <Check size={16} />
                  </button>
                  <button className="secondary-button" onClick={onStop}>
                    Stop task
                  </button>
                </div>
              </div>
            </div>
          )}
          {run.status === "awaiting_confirmation" && (
            <div className="approval-panel" role="status">
              <Check size={22} />
              <div>
                <h3>Does the result look right?</h3>
                <p>
                  Otto has reached a stopping point. Check the selected app and
                  confirm whether your task is complete.
                </p>
                <div className="approval-buttons">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={onConfirm}
                  >
                    Confirm complete
                    <Check size={16} />
                  </button>
                  <button className="secondary-button" onClick={onStop}>
                    Stop without confirming
                  </button>
                </div>
              </div>
            </div>
          )}
          {(run.result || run.error) && (
            <p
              className={`run-result ${run.error ? "error-text" : ""}`}
              role="status"
            >
              {run.error || run.result}
            </p>
          )}
          {run.status === "running" && (
            <div className="working-indicator" role="status">
              <LoaderCircle className="spinner" size={15} />
              Otto is observing your selected app.
            </div>
          )}
          {exportError && (
            <p className="form-error" role="alert">
              {exportError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
