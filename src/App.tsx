import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  errorMessage,
  nativeAPI,
  type DesktopApp,
  type OttoConfig,
  type Permissions,
} from "./api";
import { useRun } from "./useRun";
import { Activity } from "./components/Activity";
import { DesktopPreview } from "./components/DesktopPreview";
import { Dialog } from "./components/Dialog";
import { ExternalLink } from "./components/ExternalLink";

const defaultSource = "https://github.com/NobleSpartan6/otto";
type AppsResult = { apps: DesktopApp[]; permissions: Permissions };

export default function App() {
  const native = Boolean(window.otto);
  const [goal, setGoal] = useState("");
  const [config, setConfig] = useState<OttoConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [desktop, setDesktop] = useState<AppsResult | null>(null);
  const [appsError, setAppsError] = useState("");
  const [loadingApps, setLoadingApps] = useState(false);
  const [appIds, setAppIds] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [plannerScreenshot, setPlannerScreenshot] = useState(false);
  const [mode, setMode] = useState<"hybrid" | "jev">("hybrid");
  const [dialog, setDialog] = useState<"how" | "settings" | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [plannerKey, setPlannerKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const { run, busy, error, active, start, action } = useRun();
  const sourceUrl = config?.sourceUrl || defaultSource;
  const selectedApp =
    run?.snapshot?.app || desktop?.apps.find((app) => app.id === appIds[0]);
  const permissionsReady =
    desktop?.permissions.accessibility &&
    (!plannerScreenshot || desktop.permissions.screenCapture);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    setLoadingApps(true);
    void Promise.allSettled([nativeAPI().config(), nativeAPI().apps()]).then(
      ([configuration, applications]) => {
        if (cancelled) return;
        if (configuration.status === "fulfilled")
          setConfig(configuration.value);
        else
          setConfigError(
            errorMessage(
              configuration.reason,
              "Unable to connect to the desktop runtime.",
            ),
          );
        if (applications.status === "fulfilled") setDesktop(applications.value);
        else
          setAppsError(
            errorMessage(applications.reason, "Unable to list applications."),
          );
        setLoadingApps(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [native]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (run && !active) {
      setConsent(false);
      setPlannerScreenshot(false);
    }
  }, [run?.status, active]);

  async function refreshApps() {
    setLoadingApps(true);
    setAppsError("");
    try {
      const next = await nativeAPI().apps();
      setDesktop(next);
      setAppIds((current) =>
        current.filter((id) => next.apps.some((app) => app.id === id)),
      );
    } catch (cause) {
      setAppsError(errorMessage(cause, "Unable to list applications."));
    } finally {
      setLoadingApps(false);
    }
  }
  async function requestPermission(kind: "accessibility" | "screenCapture") {
    setAppsError("");
    setLoadingApps(true);
    try {
      const permissions = await nativeAPI().permissions(kind);
      setDesktop((current) =>
        current ? { ...current, permissions } : { apps: [], permissions },
      );
    } catch (cause) {
      setAppsError(errorMessage(cause, "Unable to open system permissions."));
    } finally {
      setLoadingApps(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      active ||
      busy ||
      !goal.trim() ||
      !appIds.length ||
      !consent ||
      !permissionsReady
    )
      return;
    if (
      !config?.configured ||
      (mode === "hybrid" && !config.plannerConfigured)
    ) {
      setKeyError(
        mode === "hybrid"
          ? "Hybrid mode needs both a TypeSafe key and an OpenAI API key."
          : "Add a TypeSafe key to continue.",
      );
      setDialog("settings");
      return;
    }
    await start(
      goal.trim(),
      appIds,
      consent,
      mode,
      mode === "hybrid" && plannerScreenshot,
    );
  }
  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    if (!native || (!apiKey.trim() && !plannerKey.trim())) {
      setDialog(null);
      return;
    }
    setKeyBusy(true);
    setKeyError("");
    try {
      if (apiKey.trim()) {
        await nativeAPI().saveKey(apiKey.trim(), rememberKey);
        setApiKey("");
      }
      if (plannerKey.trim()) {
        await nativeAPI().savePlannerKey(plannerKey.trim(), rememberKey);
        setPlannerKey("");
      }
      setConfig(await nativeAPI().config());
      setKeyMessage(
        rememberKey
          ? "Keys saved securely on this computer."
          : "Keys ready for this session.",
      );
    } catch (cause) {
      setKeyError(errorMessage(cause, "Unable to save the key."));
    } finally {
      setKeyBusy(false);
    }
  }
  async function clearKey(provider: "typesafe" | "openai") {
    setKeyBusy(true);
    setKeyError("");
    try {
      if (provider === "typesafe") {
        await nativeAPI().clearKey();
        setApiKey("");
      } else {
        await nativeAPI().clearPlannerKey();
        setPlannerKey("");
      }
      setConfig(await nativeAPI().config());
      setKeyMessage("Key removed.");
    } catch (cause) {
      setKeyError(errorMessage(cause, "Unable to remove the key."));
    } finally {
      setKeyBusy(false);
    }
  }
  async function share() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(
        native ? sourceUrl : window.location.origin,
      );
      setCopied(true);
    } catch {
      setCopyError(
        "Copy the project address from the GitHub link to share Otto.",
      );
    }
  }

  return (
    <div className={native ? "native-app" : "web-app"}>
      <header className="site-header">
        {native ? (
          <span className="wordmark" aria-label="Otto">
            otto<span>*</span>
          </span>
        ) : (
          <a href="/" className="wordmark" aria-label="Otto home">
            otto<span>*</span>
          </a>
        )}
        <nav aria-label="Main navigation">
          <button onClick={() => setDialog("how")}>How it works</button>
          {!native && (
            <ExternalLink href={sourceUrl}>
              GitHub
              <ArrowUpRight size={13} />
            </ExternalLink>
          )}
          {native && (
            <button onClick={() => setDialog("settings")}>Settings</button>
          )}
        </nav>
      </header>
      <main className="app-layout">
        <aside className="task-rail">
          <div className="intro">
            <h1>
              Your computer.
              <br />A little more
              <br className="desktop-linebreak" /> capable.
            </h1>
            {native ? (
              <p>Give Otto a task. Stay in control.</p>
            ) : (
              <p>
                An open-source computer-use agent
                <br />
                for macOS and Windows.
              </p>
            )}
          </div>
          <div className="task-panel">
            {native ? (
              <form onSubmit={submit}>
                <label className="task-label" htmlFor="goal">
                  Your task
                </label>
                <textarea
                  id="goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  disabled={active || busy}
                  maxLength={2000}
                  required
                  placeholder={
                    mode === "hybrid"
                      ? "In TextEdit, write a short thank-you note."
                      : "In TextEdit, type “Hello from Otto”."
                  }
                  spellCheck={false}
                />
                <div className="field-heading">
                  <span id="apps-label">Apps Otto can use</span>
                  <button
                    type="button"
                    className="refresh-apps"
                    onClick={refreshApps}
                    disabled={loadingApps || active || busy}
                  >
                    {loadingApps ? (
                      <>
                        <RefreshCw size={12} className="spinner" />
                        Refreshing…
                      </>
                    ) : (
                      "Refresh"
                    )}
                  </button>
                </div>
                <div
                  className="app-checklist"
                  role="group"
                  aria-labelledby="apps-label"
                >
                  {desktop?.apps.map((app) => (
                    <label key={app.id}>
                      <input
                        type="checkbox"
                        checked={appIds.includes(app.id)}
                        disabled={
                          active ||
                          busy ||
                          loadingApps ||
                          (!appIds.includes(app.id) && appIds.length >= 4)
                        }
                        onChange={(event) => {
                          setAppIds((current) =>
                            event.target.checked
                              ? [...current, app.id]
                              : current.filter((id) => id !== app.id),
                          );
                          setConsent(false);
                          setPlannerScreenshot(false);
                        }}
                      />
                      <span>{app.name}</span>
                    </label>
                  ))}
                  {loadingApps && !desktop && (
                    <p>Finding your open applications…</p>
                  )}
                </div>
                {appsError && (
                  <p className="form-error" role="alert">
                    {appsError}
                  </p>
                )}
                {desktop && !desktop.apps.length && (
                  <p className="setup-note">
                    Open an app, then refresh this list.
                  </p>
                )}
                {desktop &&
                  (!desktop.permissions.accessibility ||
                    !desktop.permissions.screenCapture) && (
                    <div className="permissions-note">
                      <ShieldCheck size={18} />
                      <div>
                        <strong>Give Otto permission to help.</strong>
                        <p>
                          {desktop.permissions.platform === "darwin"
                            ? "Allow Otto in System Settings → Privacy & Security, then check again. Screen capture is optional for text-only tasks."
                            : "Enable access to your applications and screen in your desktop session."}
                        </p>
                        <div className="permission-actions">
                          {!desktop.permissions.accessibility && (
                            <button
                              type="button"
                              onClick={() =>
                                void requestPermission("accessibility")
                              }
                              disabled={loadingApps}
                            >
                              Allow accessibility
                            </button>
                          )}
                          {!desktop.permissions.screenCapture && (
                            <button
                              type="button"
                              onClick={() =>
                                void requestPermission("screenCapture")
                              }
                              disabled={loadingApps}
                            >
                              Allow screen capture
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={refreshApps}
                            disabled={loadingApps}
                          >
                            Check again
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                <fieldset className="mode-picker" disabled={active || busy}>
                  <legend>Agent mode</legend>
                  <div>
                    <label className={mode === "hybrid" ? "selected" : ""}>
                      <input
                        type="radio"
                        name="mode"
                        value="hybrid"
                        checked={mode === "hybrid"}
                        onChange={() => {
                          setMode("hybrid");
                          setConsent(false);
                          setPlannerScreenshot(false);
                        }}
                      />
                      Hybrid
                    </label>
                    <label className={mode === "jev" ? "selected" : ""}>
                      <input
                        type="radio"
                        name="mode"
                        value="jev"
                        checked={mode === "jev"}
                        onChange={() => {
                          setMode("jev");
                          setConsent(false);
                          setPlannerScreenshot(false);
                        }}
                      />
                      Jev only
                    </label>
                  </div>
                  <p>
                    {mode === "hybrid"
                      ? "OpenAI plans. TypeSafe Jev selects actions."
                      : "TypeSafe Jev chooses from native app controls."}
                  </p>
                </fieldset>
                <label className="checkbox-label consent-label">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    disabled={active || busy}
                  />
                  <span>
                    {mode === "hybrid"
                      ? "I allow the selected apps’ text and controls to be sent to TypeSafe and OpenAI for this task."
                      : "I allow the selected apps’ text and controls to be sent to TypeSafe for this task."}
                  </span>
                </label>
                {mode === "hybrid" && (
                  <label className="checkbox-label consent-label">
                    <input
                      type="checkbox"
                      checked={plannerScreenshot}
                      onChange={(event) =>
                        setPlannerScreenshot(event.target.checked)
                      }
                      disabled={
                        active || busy || !desktop?.permissions.screenCapture
                      }
                    />
                    <span>
                      Also allow selected-window screenshots to OpenAI for
                      visual planning. Optional.
                    </span>
                  </label>
                )}
                <button
                  className="primary-button start-button"
                  disabled={
                    active ||
                    busy ||
                    !goal.trim() ||
                    !appIds.length ||
                    !permissionsReady ||
                    !consent
                  }
                  type="submit"
                >
                  {busy ? (
                    <>
                      <LoaderCircle size={17} className="spinner" />
                      Please wait…
                    </>
                  ) : active ? (
                    "Task in progress"
                  ) : run ? (
                    "Run again"
                  ) : (
                    "Start task"
                  )}
                </button>
                <p className="control-note">
                  Your apps. Your key. You approve every action.
                </p>
                {(!config?.configured ||
                  (mode === "hybrid" && !config?.plannerConfigured)) && (
                  <button
                    type="button"
                    className="setup-link"
                    onClick={() => setDialog("settings")}
                  >
                    {mode === "hybrid"
                      ? "Connect your API keys to get started"
                      : "Add your TypeSafe key to get started"}
                    <ArrowUpRight size={13} />
                  </button>
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
              </form>
            ) : (
              <div className="get-started">
                <h2>
                  A little direction.
                  <br />A lot done.
                </h2>
                <p>
                  Bring Otto to the apps you already use. Give it a task, see
                  what it intends to do, and approve each step.
                </p>
                <ExternalLink
                  className="primary-button"
                  href={`${sourceUrl}#getting-started`}
                >
                  Get started
                  <ArrowUpRight size={17} />
                </ExternalLink>
                <p className="control-note">
                  Run locally. Bring your own API keys.
                </p>
              </div>
            )}
            {configError && (
              <p className="form-error" role="alert">
                {configError}
              </p>
            )}
            {!native && (
              <div className="principles">
                <div>
                  <ShieldCheck size={18} />
                  <span>
                    <strong>Every action, in the open.</strong>
                    <small>Review the exact action before it runs.</small>
                  </span>
                </div>
                <div>
                  <Check size={18} />
                  <span>
                    <strong>Your computer stays yours.</strong>
                    <small>Stop any task. Inspect the full trace.</small>
                  </span>
                </div>
              </div>
            )}
            <div className="rail-footer">
              <ExternalLink href="https://docs.typesafe.ai/introduction">
                {native ? "TypeSafe Jev" : "Actions powered by TypeSafe Jev"}
              </ExternalLink>
              {native && (
                <span>
                  · Your API keys ·{" "}
                  {config?.platform === "win32" ? "Your PC" : "Your Mac"}
                </span>
              )}
              <button
                onClick={share}
                aria-label="Copy project link"
                title="Copy project link"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            {(copied || copyError) && (
              <p className="share-feedback" role="status">
                {copied ? "Link copied. Pass it on." : copyError}
              </p>
            )}
          </div>
        </aside>
        <div className="workspace-column">
          <DesktopPreview
            screenCaptureAllowed={desktop?.permissions.screenCapture}
            appName={selectedApp?.name || ""}
            run={run}
            native={native}
            sourceUrl={sourceUrl}
          />
          <Activity
            native={native}
            platform={config?.platform}
            run={run}
            busy={busy}
            onApprove={() => void action("approve")}
            onConfirm={() => void action("confirm")}
            onStop={() => void action("stop")}
          />
        </div>
      </main>
      {dialog === "how" && (
        <Dialog
          title="A little direction is all it takes."
          onClose={() => setDialog(null)}
        >
          <div className="how-content">
            <p>
              Otto is an open-source desktop computer-use agent. It runs on your
              machine and works with apps you choose.
            </p>
            <ol>
              <li>
                <strong>Choose your apps and a task.</strong>
                <span>
                  Connect your API keys and select the applications Otto can
                  use. Hybrid mode combines an OpenAI planner with TypeSafe Jev.
                  Jev-only mode uses TypeSafe for concrete control-based tasks.
                </span>
              </li>
              <li>
                <strong>Review the next action.</strong>
                <span>
                  Otto observes the selected app, proposes a grounded action,
                  and waits for your approval. Guided mode keeps you in control
                  of every step.
                </span>
              </li>
              <li>
                <strong>Check the result.</strong>
                <span>
                  Follow real screen captures and activity. Stop any time. You
                  confirm when the task is complete.
                </span>
              </li>
            </ol>
            <div className="info-note">
              This is an early source release for macOS and Windows. Control
              availability depends on the target app. In Jev-only mode, quote
              exact text for typing tasks.
            </div>
            <p className="small-copy">
              With your consent, TypeSafe receives app text and controls. Hybrid
              mode also sends selected-app text to OpenAI. Screenshots stay
              local unless you separately allow visual planning. Keys stay in
              memory by default, with optional OS-encrypted storage.
            </p>
            <button className="primary-button" onClick={() => setDialog(null)}>
              Got it
              <ChevronRight size={17} />
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "settings" && (
        <Dialog
          title="Your Otto settings"
          onClose={() => {
            setApiKey("");
            setPlannerKey("");
            setDialog(null);
          }}
        >
          <form className="settings-form" onSubmit={saveKey}>
            <p>
              Bring your own keys. Use both providers for Hybrid mode, or
              TypeSafe alone for Jev-only mode.
            </p>
            <label htmlFor="api-key">
              TypeSafe API key{" "}
              <span className="connection-status">
                {config?.configured ? "Connected" : "Not connected"}
              </span>
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setKeyMessage("");
              }}
              autoComplete="off"
              placeholder={
                config?.configured
                  ? "Paste a replacement key"
                  : "Paste your TypeSafe key"
              }
              spellCheck={false}
              disabled={keyBusy}
            />
            <p className="field-hint">
              Jev selects actions grounded in your app’s controls.
            </p>
            <label htmlFor="planner-key">
              OpenAI API key{" "}
              <span className="connection-status">
                {config?.plannerConfigured ? "Connected" : "For Hybrid mode"}
              </span>
            </label>
            <input
              id="planner-key"
              type="password"
              value={plannerKey}
              onChange={(event) => {
                setPlannerKey(event.target.value);
                setKeyMessage("");
              }}
              autoComplete="off"
              placeholder={
                config?.plannerConfigured
                  ? "Paste a replacement key"
                  : "Paste your OpenAI API key"
              }
              spellCheck={false}
              disabled={keyBusy}
            />
            <p className="field-hint">
              GPT-6 Astra plans from app observations. An OpenAI API key is
              separate from a ChatGPT subscription.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(event) => setRememberKey(event.target.checked)}
                disabled={keyBusy}
              />
              <span>Remember keys on this computer with OS encryption.</span>
            </label>
            <p className="field-hint">
              Keys are sent only to the local runtime and their respective
              provider. They stay in memory unless you choose to remember them.
            </p>
            {config && (
              <p className="limits-note">
                Up to {config.maxSteps} actions per task · Otto {config.version}
              </p>
            )}
            {keyError && (
              <p className="form-error" role="alert">
                {keyError}
              </p>
            )}
            {keyMessage && (
              <p className="key-message" role="status">
                {keyMessage}
              </p>
            )}
            <div className="dialog-actions">
              <ExternalLink href="https://console.typesafe.ai/home">
                Get a TypeSafe key
                <ArrowUpRight size={14} />
              </ExternalLink>
              <button
                className="primary-button"
                type="submit"
                disabled={keyBusy}
              >
                {keyBusy
                  ? "Please wait…"
                  : apiKey.trim() || plannerKey.trim()
                    ? "Save keys"
                    : "Done"}
                <Check size={16} />
              </button>
            </div>
            <div className="remove-keys">
              {config?.configured && (
                <button
                  className="remove-key"
                  type="button"
                  onClick={() => void clearKey("typesafe")}
                  disabled={keyBusy || active}
                >
                  Remove TypeSafe key
                </button>
              )}
              {config?.plannerConfigured && (
                <button
                  className="remove-key"
                  type="button"
                  onClick={() => void clearKey("openai")}
                  disabled={keyBusy || active}
                >
                  Remove OpenAI key
                </button>
              )}
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
