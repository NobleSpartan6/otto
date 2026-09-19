import { useState, type FormEvent } from "react";
import { ArrowUpRight, Check, KeyRound, LoaderCircle } from "lucide-react";
import { errorMessage, nativeAPI, type OttoConfig } from "../api";
import { Dialog } from "../components/Dialog";
import { ExternalLink } from "../components/ExternalLink";

export function ProviderDialog({
  config,
  plannerNeeded,
  locked,
  onUpdate,
  onClose,
}: {
  config: OttoConfig | null;
  plannerNeeded: boolean;
  locked: boolean;
  onUpdate: (config: OttoConfig) => void;
  onClose: () => void;
}) {
  const [typeSafeKey, setTypeSafeKey] = useState("");
  const [plannerKey, setPlannerKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [advanced, setAdvanced] = useState(plannerNeeded);

  async function updateConfig() {
    const next = await nativeAPI().config();
    onUpdate(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || locked || (!typeSafeKey.trim() && !plannerKey.trim())) return;
    setBusy(true);
    setError("");
    try {
      if (typeSafeKey.trim()) {
        await nativeAPI().saveKey(typeSafeKey.trim(), remember);
        setTypeSafeKey("");
      }
      if (plannerKey.trim()) {
        await nativeAPI().savePlannerKey(plannerKey.trim(), remember);
        setPlannerKey("");
      }
      await updateConfig();
      onClose();
    } catch (cause) {
      setError(
        errorMessage(cause, "The key could not be saved. Please try again."),
      );
      try {
        await updateConfig();
      } catch {
        /* Keep entered keys and the original actionable error. */
      }
    } finally {
      setBusy(false);
    }
  }
  async function remove(provider: "typesafe" | "openai") {
    setBusy(true);
    setError("");
    try {
      if (provider === "typesafe") await nativeAPI().clearKey();
      else await nativeAPI().clearPlannerKey();
      await updateConfig();
      setNotice(
        `${provider === "typesafe" ? "TypeSafe" : "OpenAI"} key removed.`,
      );
    } catch (cause) {
      setError(errorMessage(cause, "The key could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={config?.configured ? "Your connections" : "Connect TypeSafe"}
      onClose={onClose}
      dismissible={!busy}
      className="provider-dialog"
    >
      <p className="dialog-description">
        TypeSafe powers guided tasks. Form fills and dictation don’t need an API
        key.
      </p>
      <form onSubmit={save} className="provider-form">
        <div className="provider-label">
          <label htmlFor="typesafe-key">
            <KeyRound size={15} />
            TypeSafe Jev
          </label>
          <span className={config?.configured ? "key-added" : ""}>
            {config?.configured ? "Key added" : "No key added"}
          </span>
        </div>
        <input
          id="typesafe-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-initial-focus={!plannerNeeded}
          value={typeSafeKey}
          onChange={(event) => setTypeSafeKey(event.target.value)}
          placeholder={
            config?.configured
              ? "Paste a replacement API key"
              : "Paste your TypeSafe API key"
          }
          disabled={busy || locked}
        />
        <div className="provider-helper">
          <p className="field-hint">
            Saving a key doesn’t verify it. Your first task checks API access.
          </p>
          <ExternalLink href="https://console.typesafe.ai/home">
            Get a key
            <ArrowUpRight size={12} />
          </ExternalLink>
        </div>
        {config?.configured && (
          <button
            className="remove-key"
            type="button"
            onClick={() => void remove("typesafe")}
            disabled={busy || locked}
          >
            Remove TypeSafe key
          </button>
        )}
        <details
          className="optional-provider"
          open={advanced}
          onToggle={(event) => setAdvanced(event.currentTarget.open)}
        >
          <summary>
            OpenAI planner<span>Optional</span>
          </summary>
          <p className="field-hint">
            Hybrid mode adds planning and writing with GPT-6 Astra. An API key
            is separate from a ChatGPT subscription.
          </p>
          <div className="provider-label">
            <label htmlFor="planner-key">OpenAI API key</label>
            <span className={config?.plannerConfigured ? "key-added" : ""}>
              {config?.plannerConfigured ? "Key added" : "No key added"}
            </span>
          </div>
          <input
            id="planner-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-initial-focus={plannerNeeded}
            value={plannerKey}
            onChange={(event) => setPlannerKey(event.target.value)}
            placeholder={
              config?.plannerConfigured
                ? "Paste a replacement API key"
                : "Paste your OpenAI API key"
            }
            disabled={busy || locked}
          />
          {config?.plannerConfigured && (
            <button
              className="remove-key"
              type="button"
              onClick={() => void remove("openai")}
              disabled={busy || locked}
            >
              Remove OpenAI key
            </button>
          )}
        </details>
        <label className="check-line">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            disabled={busy || locked}
          />
          <span>Remember keys with this computer’s OS encryption.</span>
        </label>
        <p className="field-hint privacy-hint">
          Otherwise, keys stay in memory for this session. Each key goes only to
          its provider through the local Otto app.
        </p>
        {locked && (
          <p className="field-hint">
            Stop the current task before changing connections.
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="inline-notice" role="status">
            {notice}
          </p>
        )}
        <div className="dialog-footer">
          <span className="field-hint">
            {config ? `Otto ${config.version}` : "Local desktop app"}
          </span>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Close
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={
                busy || locked || (!typeSafeKey.trim() && !plannerKey.trim())
              }
            >
              {busy ? (
                <LoaderCircle size={15} className="spinner" />
              ) : (
                <Check size={15} />
              )}
              {busy ? "Saving…" : "Save connection"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
