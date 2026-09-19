import { useEffect, useRef, useState } from "react";
import { AppWindow, Expand, Focus, Maximize2, ShieldCheck } from "lucide-react";
import { type DesktopApp, type OttoRun, type Permissions } from "../api";

export function AppContext({
  run,
  selected,
  permissions,
  onChooseApps,
  onCapturePermission,
  permissionError,
  onRetryPermissions,
}: {
  permissionError: string;
  onRetryPermissions: () => void;
  run: OttoRun | null;
  selected: DesktopApp[];
  permissions: Permissions | null;
  onChooseApps: () => void;
  onCapturePermission: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [imageError, setImageError] = useState(false);
  const snapshot = run?.snapshot;
  const screenshot = snapshot?.screenshot;
  const currentApp = snapshot?.app || selected[0];
  useEffect(() => setImageError(false), [screenshot]);
  useEffect(() => setZoom(false), [run?.id]);
  useEffect(() => {
    if (!snapshot?.capturedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [snapshot?.capturedAt]);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch {
      /* The screenshot remains available if the host disallows fullscreen. */
    }
  }
  const time = snapshot?.capturedAt
    ? new Date(snapshot.capturedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";
  const age = snapshot?.capturedAt
    ? Math.max(0, Math.floor((now - Date.parse(snapshot.capturedAt)) / 1000))
    : 0;
  const ageLabel =
    age < 60
      ? `${age}s ago`
      : age < 3600
        ? `${Math.floor(age / 60)}m ago`
        : `${Math.floor(age / 3600)}h ago`;
  const captureOff = permissions?.screenCapture === false;
  return (
    <section
      ref={panel}
      className="context-pane"
      id="app-view"
      aria-label="Selected app view"
    >
      <header className="context-toolbar">
        <span className="context-app-icon">
          <AppWindow size={17} />
        </span>
        <div>
          <strong>{currentApp?.name || "Your workspace"}</strong>
          <span>
            {snapshot?.title ||
              (selected.length
                ? `${selected.length} ${selected.length === 1 ? "app" : "apps"} available to Otto`
                : "Choose where Otto can help")}
          </span>
        </div>
        <div className="context-tools">
          {screenshot && (
            <>
              <button
                className={`icon-button ${zoom ? "is-active" : ""}`}
                onClick={() => setZoom((value) => !value)}
                aria-label={
                  zoom
                    ? "Fit screenshot to view"
                    : "View screenshot at original size"
                }
                title={zoom ? "Fit to view" : "Original size"}
              >
                {zoom ? <Focus size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                className="icon-button"
                onClick={fullscreen}
                aria-label="Expand app view"
                title="Expand app view"
              >
                <Expand size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      {permissionError && (
        <div className="context-error inline-error" role="alert">
          {permissionError}
          <button className="text-button" onClick={onRetryPermissions}>
            Check again
          </button>
        </div>
      )}
      <div
        className={`context-canvas ${screenshot && !imageError ? "has-capture" : ""} ${zoom ? "original-size" : ""}`}
      >
        {screenshot && !imageError ? (
          <img
            src={screenshot}
            alt={`Screen capture of ${snapshot?.app.name || "the selected app"}${snapshot?.title ? `: ${snapshot.title}` : ""}`}
            onError={() => setImageError(true)}
          />
        ) : snapshot?.text ? (
          <article className="observed-text">
            <h2>Observed app text</h2>
            <pre>{snapshot.text}</pre>
          </article>
        ) : (
          <div className="context-empty">
            <div className="context-empty-mark">
              <AppWindow size={42} strokeWidth={1.1} />
            </div>
            <h2>
              {captureOff
                ? "Your apps. Text-only view."
                : run?.status === "running"
                  ? "Getting a clear view."
                  : currentApp
                    ? `${currentApp.name}, ready for a hand.`
                    : "A clear view of every move."}
            </h2>
            <p>
              {captureOff
                ? "Otto can still use native app controls. Allow screen capture to see the selected window here."
                : snapshot || imageError
                  ? "A screen capture isn’t available for this app. Follow the task in the panel beside it."
                  : currentApp
                    ? "Start a task to see the selected app here. Every action is yours to review."
                    : "Choose an app and give Otto a task. This space follows what happens next."}
            </p>
            {captureOff ? (
              <button
                className="secondary-button"
                onClick={onCapturePermission}
              >
                Enable screen capture
              </button>
            ) : !selected.length && !run ? (
              <button className="secondary-button" onClick={onChooseApps}>
                <AppWindow size={14} />
                Choose apps
              </button>
            ) : null}
          </div>
        )}
      </div>
      <footer className="context-footer">
        <span>
          <ShieldCheck size={13} />
          Only the apps you choose.
        </span>
        <span title={time || undefined}>
          {snapshot
            ? `Captured ${ageLabel}`
            : "Screen captures appear after a task starts."}
          {screenshot && <small>Read-only view</small>}
        </span>
      </footer>
    </section>
  );
}
