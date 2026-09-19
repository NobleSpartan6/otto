import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AppWindow,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  KeyRound,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Sparkles,
} from "lucide-react";
import { isActive } from "../api";
import { useRun } from "../useRun";
import { AppContext } from "./AppContext";
import { AppPicker } from "./AppPicker";
import { HelpDialog } from "./HelpDialog";
import { ProviderDialog } from "./ProviderDialog";
import { DecisionCard, RUN_LABELS, RunThread } from "./RunThread";
import { useDesktop } from "./useDesktop";
import "./native.css";

type Mode = "jev" | "hybrid";
type DialogKind = "providers" | "apps" | "help" | null;

export function NativeWorkspace() {
  const desktop = useDesktop();
  const task = useRun();
  const [goal, setGoal] = useState("");
  const [appIds, setAppIds] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("jev");
  const [consent, setConsent] = useState(false);
  const [plannerScreenshot, setPlannerScreenshot] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [view, setView] = useState<"task" | "app">("task");
  const [validation, setValidation] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);
  const onboardingShown = useRef(false);
  const thread = useRef<HTMLDivElement>(null);
  const { run, active, busy, error } = task;
  const selectedApps = desktop.apps.filter((app) => appIds.includes(app.id));
  const sourceUrl =
    desktop.config?.sourceUrl || "https://github.com/NobleSpartan6/otto";
  const starterApp =
    desktop.config?.platform === "win32" ? "Notepad" : "TextEdit";
  const starterGoal = `In ${starterApp}, type “Hello from Otto”.`;
  const needsKey =
    !desktop.config?.configured ||
    (mode === "hybrid" && !desktop.config?.plannerConfigured);
  const needsAccess = !desktop.permissions?.accessibility;
  const needsApps = selectedApps.length === 0;
  const decision =
    run?.status === "awaiting_approval" ||
    run?.status === "awaiting_confirmation";
  const statusLabel =
    busy && !active
      ? "Starting task"
      : run
        ? RUN_LABELS[run.status]
        : desktop.loading
          ? "Loading workspace…"
          : desktop.configError
            ? "Connection issue"
            : "Ready when you are";

  useEffect(() => {
    if (!desktop.config || onboardingShown.current) return;
    onboardingShown.current = true;
    if (!desktop.config.configured) setDialog("providers");
  }, [desktop.config]);
  useEffect(() => {
    if (run && !isActive(run)) {
      setConsent(false);
      setPlannerScreenshot(false);
    }
  }, [run?.status]);
  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(76, Math.min(input.scrollHeight, 160))}px`;
  }, [goal, active]);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = 0;
  }, [run?.id]);

  function focusComposer() {
    requestAnimationFrame(() => textarea.current?.focus());
  }
  function sampleTask() {
    setGoal(starterGoal);
    setMode("jev");
    setConsent(false);
    setPlannerScreenshot(false);
    setValidation("");
    focusComposer();
  }
  function freshTask(retry = false) {
    if (active || busy) return;
    const previous = run;
    task.reset();
    setGoal(retry && previous ? previous.goal : "");
    if (retry && previous) {
      setAppIds(previous.appIds);
      setMode(previous.mode || "jev");
    }
    setConsent(false);
    setPlannerScreenshot(false);
    setValidation("");
    setOptionsOpen(false);
    setView("task");
    focusComposer();
  }
  async function refreshApps() {
    const result = await desktop.refreshApps();
    if (!result) return;
    const next = appIds.filter((id) =>
      result.apps.some((app) => app.id === id),
    );
    if (next.length !== appIds.length) {
      setAppIds(next);
      setConsent(false);
      setPlannerScreenshot(false);
    }
  }
  function reviewConsent() {
    setOptionsOpen(true);
    requestAnimationFrame(() => consentInput.current?.focus());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (active || busy || desktop.loading) return;
    if (desktop.configError) {
      setValidation("Reconnect to the local runtime before starting.");
      void desktop.retryRuntime();
      return;
    }
    if (!goal.trim()) {
      setValidation("Write a task for Otto first.");
      focusComposer();
      return;
    }
    if (needsKey) {
      setValidation(
        mode === "hybrid"
          ? "Add both provider keys to use Hybrid mode."
          : "Add your TypeSafe API key to start.",
      );
      setDialog("providers");
      return;
    }
    if (needsAccess || needsApps) {
      setValidation(
        needsAccess
          ? "Allow app access, then choose an app."
          : "Choose at least one app for this task.",
      );
      setDialog("apps");
      return;
    }
    if (!consent) {
      setValidation("Review data sharing before starting this task.");
      reviewConsent();
      return;
    }
    if (plannerScreenshot && !desktop.permissions?.screenCapture) {
      setValidation("Screen capture permission is needed for visual planning.");
      setOptionsOpen(true);
      return;
    }
    setValidation("");
    if (
      await task.start(
        goal.trim(),
        appIds,
        consent,
        mode,
        mode === "hybrid" && plannerScreenshot,
      )
    ) {
      setGoal("");
      setOptionsOpen(false);
    }
  }

  const prerequisite = desktop.configError
    ? "Reconnect to the local runtime"
    : needsKey
      ? "Connect your API key"
      : needsAccess
        ? "Allow app access"
        : needsApps
          ? "Choose your apps"
          : !consent
            ? "Review data sharing"
            : "";
  function resolvePrerequisite() {
    if (desktop.configError) void desktop.retryRuntime();
    else if (needsKey) setDialog("providers");
    else if (needsAccess || needsApps) setDialog("apps");
    else reviewConsent();
  }

  return (
    <div className="native-workspace">
      <header className="workspace-header">
        <div className="workspace-brand" aria-label="Otto">
          otto<span>*</span>
        </div>
        <span className="header-divider" />
        <span className="workspace-name">Your workspace</span>
        <span
          className={`workspace-status status-${run?.status || "idle"}`}
          role="status"
        >
          <i />
          {statusLabel}
        </span>
        <div className="workspace-header-actions">
          {active && (
            <button
              className="header-stop"
              onClick={() => void task.action("stop")}
              title={`Stop task (${desktop.config?.platform === "win32" ? "Ctrl" : "⌘"} ⇧ ⌫)`}
            >
              <Square size={11} fill="currentColor" />
              Stop task
            </button>
          )}
          <button
            className="icon-button"
            aria-label="How Otto works"
            title="How Otto works"
            onClick={() => setDialog("help")}
          >
            <CircleHelp size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Settings and connections"
            title="Settings and connections"
            onClick={() => setDialog("providers")}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      <nav className="workspace-view-switch" aria-label="Workspace view">
        <button
          className={view === "task" ? "is-selected" : ""}
          aria-pressed={view === "task"}
          onClick={() => setView("task")}
        >
          Task{decision && <i />}
        </button>
        <button
          className={view === "app" ? "is-selected" : ""}
          aria-pressed={view === "app"}
          onClick={() => setView("app")}
        >
          App view
        </button>
      </nav>
      <main className="native-stage" data-view={view}>
        <aside
          className="task-pane"
          id="task-view"
          aria-label="Otto task panel"
        >
          <div className="task-pane-header">
            <h1>{run ? "Your task" : "New task"}</h1>
            <button
              className="icon-button"
              aria-label="New task"
              title="New task"
              onClick={() => freshTask()}
              disabled={active || busy || (!run && !goal)}
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="task-body">
            <div ref={thread} className="task-thread">
              {desktop.configError && (
                <div className="runtime-error" role="alert">
                  <p>{desktop.configError}</p>
                  <button
                    className="text-button"
                    onClick={() => void desktop.retryRuntime()}
                    disabled={desktop.loading}
                  >
                    Try again
                  </button>
                </div>
              )}
              {run ? (
                <RunThread run={run} onRetry={() => freshTask(true)} />
              ) : (
                <div className="task-introduction">
                  <span className="little-star" aria-hidden="true">
                    *
                  </span>
                  <h2>
                    A little direction.
                    <br />A lot done.
                  </h2>
                  <p>
                    Tell Otto what you need. Choose the apps, then review each
                    move.
                  </p>
                  {(needsKey || needsAccess || needsApps) && (
                    <div
                      className="setup-progress"
                      aria-label="Get ready to start"
                    >
                      <span className="thread-label">Get ready</span>
                      <button
                        className={
                          desktop.config?.configured ? "setup-done" : ""
                        }
                        onClick={() => setDialog("providers")}
                      >
                        <span>
                          {desktop.config?.configured ? (
                            <Check size={12} />
                          ) : (
                            "1"
                          )}
                        </span>
                        <strong>
                          {desktop.config?.configured
                            ? "TypeSafe key added"
                            : "Connect TypeSafe"}
                        </strong>
                        {!desktop.config?.configured && (
                          <ChevronDown size={12} />
                        )}
                      </button>
                      <button
                        className={
                          desktop.permissions?.accessibility ? "setup-done" : ""
                        }
                        onClick={() => setDialog("apps")}
                      >
                        <span>
                          {desktop.permissions?.accessibility ? (
                            <Check size={12} />
                          ) : (
                            "2"
                          )}
                        </span>
                        <strong>
                          {desktop.permissions?.accessibility
                            ? "App access enabled"
                            : "Allow app access"}
                        </strong>
                      </button>
                      <button
                        className={selectedApps.length ? "setup-done" : ""}
                        onClick={() => setDialog("apps")}
                      >
                        <span>
                          {selectedApps.length ? <Check size={12} /> : "3"}
                        </span>
                        <strong>
                          {selectedApps.length
                            ? `${selectedApps.length} ${selectedApps.length === 1 ? "app" : "apps"} selected`
                            : "Choose your apps"}
                        </strong>
                      </button>
                    </div>
                  )}
                  <button className="sample-task" onClick={sampleTask}>
                    <Sparkles size={14} />
                    <span>
                      Try a simple first task
                      <small>Type a greeting in {starterApp}</small>
                    </span>
                    <ArrowUp size={13} />
                  </button>
                  <p className="sample-guidance">
                    Open a blank document in {starterApp}, then choose it below.
                  </p>
                </div>
              )}
            </div>
            {decision && run && (
              <DecisionCard
                run={run}
                busy={busy}
                onApprove={() => void task.action("approve")}
                onConfirm={() => void task.action("confirm")}
                onStop={() => void task.action("stop")}
              />
            )}
            {(error || desktop.appsError) && (
              <div className="task-error inline-error" role="alert">
                {error || desktop.appsError}
                {desktop.appsError && (
                  <button
                    className="text-button"
                    onClick={() => void refreshApps()}
                    disabled={desktop.loading}
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
          <form
            className={`task-composer ${active ? "is-active" : ""}`}
            onSubmit={submit}
          >
            <div className="composer-scope">
              <button
                type="button"
                className={`scope-button ${needsApps ? "needs-apps" : ""}`}
                disabled={active || busy}
                onClick={() => setDialog("apps")}
              >
                <AppWindow size={14} />
                <span>
                  {selectedApps.length
                    ? selectedApps.map((app) => app.name).join(", ")
                    : "Choose apps"}
                </span>
                {selectedApps.length > 1 && (
                  <small>{selectedApps.length}</small>
                )}
                <ChevronDown size={12} />
              </button>
              <span className="guided-label">Guided</span>
            </div>
            <div className="composer-edit-area">
              <label className="sr-only" htmlFor="task-goal">
                Your task
              </label>
              <textarea
                ref={textarea}
                id="task-goal"
                value={goal}
                onChange={(event) => {
                  setGoal(event.target.value);
                  if (validation) setValidation("");
                }}
                placeholder={
                  active
                    ? "Task in progress. You can stop at any time."
                    : mode === "jev"
                      ? `Ask Otto to help…\nFor typing, put exact text in quotes.`
                      : "What would you like Otto to do?"
                }
                spellCheck={false}
                maxLength={2000}
                disabled={active || busy}
                aria-describedby={
                  validation ? "task-validation" : "task-helper"
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <details
                className="composer-options"
                open={optionsOpen}
                onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
              >
                <summary>
                  <SlidersHorizontal size={12} />
                  Options & privacy
                  <ChevronDown size={12} />
                </summary>
                <div className="composer-options-body">
                  <fieldset disabled={active || busy}>
                    <legend>Agent mode</legend>
                    <div className="mode-control">
                      <label className={mode === "jev" ? "is-selected" : ""}>
                        <input
                          type="radio"
                          name="agent-mode"
                          checked={mode === "jev"}
                          onChange={() => {
                            setMode("jev");
                            setConsent(false);
                            setPlannerScreenshot(false);
                          }}
                        />
                        Jev only
                      </label>
                      <label className={mode === "hybrid" ? "is-selected" : ""}>
                        <input
                          type="radio"
                          name="agent-mode"
                          checked={mode === "hybrid"}
                          onChange={() => {
                            setMode("hybrid");
                            setConsent(false);
                            setPlannerScreenshot(false);
                          }}
                        />
                        Hybrid
                      </label>
                    </div>
                    <p className="field-hint">
                      {mode === "jev"
                        ? "TypeSafe chooses actions from app controls."
                        : "OpenAI plans. TypeSafe chooses app actions."}
                    </p>
                  </fieldset>
                  <label className="check-line">
                    <input
                      ref={consentInput}
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => {
                        setConsent(event.target.checked);
                        setValidation("");
                      }}
                      disabled={active || busy}
                    />
                    <span>
                      Allow selected-app text and controls to{" "}
                      {mode === "hybrid" ? "TypeSafe and OpenAI" : "TypeSafe"}{" "}
                      for this task.
                    </span>
                  </label>
                  {mode === "hybrid" && (
                    <>
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={plannerScreenshot}
                          onChange={(event) =>
                            setPlannerScreenshot(event.target.checked)
                          }
                          disabled={
                            active ||
                            busy ||
                            !desktop.permissions?.screenCapture
                          }
                        />
                        <span>
                          Also share selected-window screenshots with OpenAI.
                          Optional.
                        </span>
                      </label>
                      {!desktop.permissions?.screenCapture && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={active || desktop.loading}
                          onClick={() =>
                            void desktop.requestPermission("screenCapture")
                          }
                        >
                          Enable screen capture
                        </button>
                      )}
                    </>
                  )}
                </div>
              </details>
              {validation && (
                <p
                  id="task-validation"
                  className="field-validation"
                  role="alert"
                >
                  {validation}
                </p>
              )}
            </div>
            <div className="composer-bottom">
              <button
                type="button"
                className="provider-button"
                onClick={() => setDialog("providers")}
                title={
                  needsKey
                    ? "Add your API key"
                    : "API key added; access is checked on your first task"
                }
              >
                <KeyRound size={12} />
                <span>{mode === "jev" ? "TypeSafe Jev" : "Hybrid"}</span>
                <ChevronDown size={11} />
              </button>
              {active ? (
                <button
                  className="send-task is-stop"
                  type="button"
                  onClick={() => void task.action("stop")}
                  aria-label="Stop task"
                  title="Stop task"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-task"
                  type="submit"
                  disabled={busy || desktop.loading}
                  aria-label="Start task"
                  title="Start task"
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spinner" />
                  ) : (
                    <ArrowUp size={18} />
                  )}
                </button>
              )}
            </div>
          </form>
          <div id="task-helper" className="composer-hint">
            {active ? (
              <>
                <ShieldCheck size={11} />
                Every action stays in your hands.
              </>
            ) : busy ? (
              <>
                <LoaderCircle size={11} className="spinner" />
                Starting…
              </>
            ) : prerequisite ? (
              <button onClick={resolvePrerequisite}>
                {prerequisite}
                <ChevronDown size={10} />
              </button>
            ) : (
              <>
                Enter to start<span>·</span>Shift + Enter for a new line
              </>
            )}
          </div>
        </aside>
        <AppContext
          permissionError={desktop.appsError}
          onRetryPermissions={() => void refreshApps()}
          run={run}
          selected={selectedApps}
          permissions={desktop.permissions}
          onChooseApps={() => setDialog("apps")}
          onCapturePermission={() =>
            void desktop.requestPermission("screenCapture")
          }
        />
      </main>
      {dialog === "apps" && (
        <AppPicker
          apps={desktop.apps}
          selected={appIds}
          permissions={desktop.permissions}
          loading={desktop.loading}
          error={desktop.appsError}
          onRefresh={() => void refreshApps()}
          onPermission={() => void desktop.requestPermission("accessibility")}
          onApply={(ids) => {
            setAppIds(ids);
            setConsent(false);
            setPlannerScreenshot(false);
            setValidation("");
            setDialog(null);
            focusComposer();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "providers" && (
        <ProviderDialog
          config={desktop.config}
          plannerNeeded={
            mode === "hybrid" && !desktop.config?.plannerConfigured
          }
          locked={active || busy}
          onUpdate={desktop.setConfig}
          onClose={() => {
            setDialog(null);
            setValidation("");
          }}
        />
      )}
      {dialog === "help" && (
        <HelpDialog sourceUrl={sourceUrl} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
