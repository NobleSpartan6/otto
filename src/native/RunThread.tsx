import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Square,
} from "lucide-react";
import { errorMessage, nativeAPI, type OttoRun } from "../api";

export const RUN_LABELS: Record<OttoRun["status"], string> = {
  running: "Working",
  awaiting_approval: "Needs approval",
  awaiting_confirmation: "Check the result",
  completed: "Confirmed complete",
  stopped: "Stopped",
  failed: "Needs attention",
  limit_reached: "Step limit reached",
  blocked: "Needs a different approach",
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

export function RunThread({
  run,
  onRetry,
}: {
  run: OttoRun;
  onRetry: () => void;
}) {
  const [exportError, setExportError] = useState("");
  const terminal = ![
    "running",
    "awaiting_approval",
    "awaiting_confirmation",
  ].includes(run.status);
  const lastEvent = run.events.at(-1);
  const actions = run.events.filter((event) => event.kind === "action");
  const result = run.error || run.result;
  async function exportTrace() {
    setExportError("");
    try {
      await nativeAPI().exportRun(run.id);
    } catch (cause) {
      setExportError(
        errorMessage(cause, "The task trace could not be exported."),
      );
    }
  }
  return (
    <>
      <article className="submitted-task">
        <span className="thread-label">Your task</span>
        <p>{run.goal}</p>
      </article>
      {run.status === "running" && (
        <div className="current-progress" role="status">
          <LoaderCircle size={15} className="spinner" />
          <div>
            <strong>{run.subgoal || "Working on your task"}</strong>
            <p>{lastEvent?.message || "Waiting for the next update."}</p>
          </div>
        </div>
      )}
      {(run.status === "awaiting_approval" ||
        run.status === "awaiting_confirmation") && (
        <p className="waiting-note">
          <span className="waiting-dot" />
          {run.status === "awaiting_approval"
            ? "A decision is ready for you below."
            : "Otto is waiting for you to check the result."}
        </p>
      )}
      {terminal && (
        <section
          className={`terminal-result result-${run.status}`}
          role="status"
        >
          <div>
            {run.status === "completed" ? (
              <Check size={18} />
            ) : run.status === "failed" || run.status === "blocked" ? (
              <CircleAlert size={18} />
            ) : (
              <Square size={14} />
            )}
            <h2>{RUN_LABELS[run.status]}</h2>
          </div>
          {result && <p>{result}</p>}
          <button className="text-button" onClick={onRetry}>
            <RotateCcw size={13} />
            {run.status === "completed"
              ? "Start a similar task"
              : "Edit and retry"}
          </button>
          {run.status !== "completed" && (
            <small>Review a fresh task before it starts.</small>
          )}
        </section>
      )}
      {run.events.length > 0 && (
        <details className="run-history">
          <summary>
            <ChevronRight size={13} />
            <span>
              {actions.length
                ? `${actions.length} ${actions.length === 1 ? "action" : "actions"} taken`
                : "Task activity"}
            </span>
            <small>{run.events.length} events</small>
          </summary>
          <ol>
            {run.events.map((event) => (
              <li key={event.id}>
                <details className="history-event">
                  <summary>
                    <span
                      className={`event-indicator ${event.kind === "error" ? "event-error" : ""}`}
                    >
                      {event.kind === "action" ? <Check size={12} /> : <span />}
                    </span>
                    <span>{event.message}</span>
                  </summary>
                  <div className="event-details">
                    <time dateTime={event.timestamp}>
                      {formatTime(event.timestamp)}
                    </time>
                    {event.model && <span>{event.model}</span>}
                    {typeof event.latencyMs === "number" && (
                      <span>{(event.latencyMs / 1000).toFixed(1)}s</span>
                    )}
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
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="trace-footer">
        <span>
          Step {run.step} of {run.maxSteps}
        </span>
        <button className="text-button" onClick={exportTrace}>
          <Download size={12} />
          Export trace
        </button>
      </div>
      {exportError && (
        <p className="inline-error" role="alert">
          {exportError}
        </p>
      )}
    </>
  );
}

export function DecisionCard({
  run,
  busy,
  onApprove,
  onConfirm,
  onStop,
}: {
  run: OttoRun;
  busy: boolean;
  onApprove: () => void;
  onConfirm: () => void;
  onStop: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const confirming = run.status === "awaiting_confirmation";
  const pending = run.pendingAction;
  const requestKey = confirming ? `${run.id}-confirm` : pending?.id;
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.closest(".task-composer"))
      heading.current?.focus({ preventScroll: true });
  }, [requestKey]);
  if (!confirming && !pending) return null;
  const structured =
    pending &&
    (pending.operation ||
      pending.target ||
      pending.value !== undefined ||
      pending.appName);
  return (
    <section
      className={`decision-card ${confirming ? "decision-confirmation" : ""}`}
      aria-labelledby="decision-title"
    >
      <div className="decision-label">
        <ShieldCheck size={14} />
        <span>
          {confirming ? "Your final check" : "Ready for your approval"}
        </span>
      </div>
      <div className="decision-content">
        <h2 ref={heading} tabIndex={-1} id="decision-title">
          {confirming
            ? "Does the result look right?"
            : structured && pending!.operation === "fill"
              ? "Enter text"
              : pending!.label}
        </h2>
        {confirming ? (
          <p>Check the selected app. Confirm only if your task is complete.</p>
        ) : (
          <>
            {structured && (
              <dl className="action-facts">
                {(pending!.appName || run.snapshot?.app.name) && (
                  <div>
                    <dt>App</dt>
                    <dd>{pending!.appName || run.snapshot?.app.name}</dd>
                  </div>
                )}
                {pending!.target && (
                  <div>
                    <dt>Control</dt>
                    <dd>{pending!.target}</dd>
                  </div>
                )}
                {pending!.value !== undefined && (
                  <div className="action-value">
                    <dt>
                      {pending!.operation === "key" ? "Keys" : "Exact text"}
                    </dt>
                    <dd>
                      {pending!.value.length > 240 ? (
                        <details>
                          <summary>
                            Review all {pending!.value.length.toLocaleString()}{" "}
                            characters
                            <ChevronRight size={12} />
                          </summary>
                          <pre>{pending!.value}</pre>
                        </details>
                      ) : (
                        <pre>{pending!.value}</pre>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {pending!.reason && (
              <p className="action-reason">{pending!.reason}</p>
            )}
          </>
        )}
      </div>
      <div className="decision-actions">
        <button className="secondary-button" onClick={onStop}>
          {confirming ? "Stop without confirming" : "Stop task"}
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={confirming ? onConfirm : onApprove}
        >
          {busy ? (
            <LoaderCircle size={14} className="spinner" />
          ) : (
            <Check size={14} />
          )}
          {confirming ? "Confirm complete" : "Approve action"}
        </button>
      </div>
    </section>
  );
}
