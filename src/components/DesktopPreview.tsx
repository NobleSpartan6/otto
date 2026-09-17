import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  ArrowUpRight,
  Maximize2,
  Monitor,
  MousePointer2,
} from "lucide-react";
import { type OttoRun } from "../api";
import { ExternalLink } from "./ExternalLink";

export function DesktopPreview({
  appName,
  run,
  native,
  sourceUrl,
  screenCaptureAllowed,
}: {
  screenCaptureAllowed?: boolean;
  appName: string;
  run: OttoRun | null;
  native: boolean;
  sourceUrl: string;
}) {
  const frame = useRef<HTMLElement>(null);
  const [imageError, setImageError] = useState(false);
  const screenshot = run?.snapshot?.screenshot;
  useEffect(() => setImageError(false), [screenshot]);
  async function expand() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.current?.requestFullscreen();
    } catch {
      /* Fullscreen availability depends on the host. */
    }
  }
  return (
    <section ref={frame} className="desktop-shell" aria-label="Desktop view">
      <div className="desktop-toolbar">
        {native ? (
          <div className="selected-app-heading">
            <strong>{appName || "Selected app"}</strong>
            <span>
              <i />
              {screenCaptureAllowed === false
                ? "Screen preview off"
                : run
                  ? run.status === "running"
                    ? "Following your task"
                    : "Your screen, in view"
                  : "Ready when you are"}
            </span>
          </div>
        ) : (
          <>
            <div className="traffic-lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span>
              <AppWindow size={14} />
              Built for your desktop
            </span>
          </>
        )}
        {native && <small className="guided-mode">Guided mode</small>}
        {screenshot && (
          <button
            type="button"
            className="icon-button"
            onClick={expand}
            aria-label="Expand desktop view"
          >
            <Maximize2 size={17} />
          </button>
        )}
      </div>
      <div className={`desktop-viewport ${screenshot ? "has-screenshot" : ""}`}>
        {screenshot ? (
          <img
            className="desktop-screenshot"
            src={screenshot}
            alt={`Screen capture of ${appName || "your selected app"} at step ${run?.step}`}
            onError={() => setImageError(true)}
          />
        ) : native ? (
          <div className="desktop-empty">
            <svg
              className="empty-window"
              viewBox="0 0 240 168"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="2"
                width="236"
                height="164"
                rx="8"
                stroke="#8f99a7"
                strokeWidth="2"
              />
              <path d="M2 34H238" stroke="#8f99a7" strokeWidth="2" />
              <g fill="#b7bec8" stroke="#8f99a7" strokeWidth="1.5">
                <circle cx="19" cy="18" r="4" />
                <circle cx="36" cy="18" r="4" />
                <circle cx="53" cy="18" r="4" />
              </g>
              <path
                d="M44 74H196M44 94H173M44 114H132"
                stroke="#e2e5e9"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </svg>
            <h2>A clear view of every move.</h2>
            <p>
              {screenCaptureAllowed === false
                ? "Screen capture is off. Otto can still work with your selected app’s text and controls."
                : run?.snapshot
                  ? "Screen capture is unavailable for this app. You can still follow the activity below."
                  : "Your selected app appears here when a task starts. Otto asks before taking an action."}
            </p>
          </div>
        ) : (
          <div className="distribution-content">
            <div className="desktop-symbol">
              <Monitor size={58} strokeWidth={1} />
              <MousePointer2 size={25} strokeWidth={1.4} />
            </div>
            <h2>
              Your apps.
              <br />A new pair of hands.
            </h2>
            <p>
              Otto turns a simple instruction into real actions on your
              computer. Plan with OpenAI. Act with TypeSafe Jev. Keep a hand on
              every step.
            </p>
            <div className="platform-list">
              <span>macOS</span>
              <span>Windows</span>
              <span>Bring your own keys</span>
            </div>
            <ExternalLink
              href={`${sourceUrl}/releases`}
              className="text-link"
            >
              Get the desktop alpha
              <ArrowUpRight size={16} />
            </ExternalLink>
            <p className="release-note">
              Unsigned test builds. Read the release notes before installing.
            </p>
          </div>
        )}
        {run?.status === "running" && !run.snapshot && (
          <div className="desktop-overlay">
            <span className="loading-dot" />
            Observing your selected app…
          </div>
        )}
        {imageError && (
          <div className="desktop-overlay">
            This screen capture is unavailable. Check the activity below.
          </div>
        )}
      </div>
    </section>
  );
}
