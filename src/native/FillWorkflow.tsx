import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Download,
  FileJson,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Square,
} from "lucide-react";
import type { BatchRun } from "../../shared/batch";
import {
  errorMessage,
  nativeAPI,
  type DesktopApp,
  type Permissions,
} from "../api";
import { Dialog } from "../components/Dialog";
import { useFill } from "./useFill";
import { parseFillFields } from "./fillValues";
import "./fill.css";

const EXAMPLE = '{\n  "Full name": "Alex Morgan",\n  "City": "Portland"\n}';

function ExactValue({ value }: { value: string | undefined }) {
  if (value === undefined)
    return <span className="fill-empty-value">No readback</span>;
  if (value === "") return <span className="fill-empty-value">Empty text</span>;
  if (value.length > 240)
    return (
      <details className="fill-long-value">
        <summary>Read all {value.length.toLocaleString()} characters</summary>
        <pre>{value}</pre>
      </details>
    );
  return <pre>{value}</pre>;
}

function FieldReview({ run }: { run: BatchRun }) {
  const review = run.status === "awaiting_approval";
  return (
    <div className="fill-table-wrap">
      <table className="fill-table">
        <caption className="sr-only">
          {review
            ? "Exact changes to review before filling"
            : "Field values and native verification results"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before</th>
            <th scope="col">{review ? "New value" : "Intended value"}</th>
            {!review && <th scope="col">Readback</th>}
          </tr>
        </thead>
        <tbody>
          {run.fields.map((field, index) => (
            <tr key={`${index}-${field.label}`}>
              <th scope="row">
                <span>{field.label}</span>
                {!review && (
                  <small className={`fill-field-status field-${field.status}`}>
                    {field.status === "verified" ? (
                      <Check size={12} />
                    ) : field.status === "failed" ? (
                      <CircleAlert size={12} />
                    ) : null}
                    {field.status === "verified"
                      ? "Verified"
                      : field.status === "failed"
                        ? "Needs attention"
                        : field.status === "skipped"
                          ? !field.error && field.after === field.proposed
                            ? "Already matches"
                            : "Not filled"
                          : "Pending"}
                  </small>
                )}
                {field.error && (
                  <p className="fill-field-error">{field.error}</p>
                )}
              </th>
              <td>
                {field.before === "" &&
                run.metrics.nativeActions === 0 &&
                field.error ? (
                  <span className="fill-empty-value">Not observed</span>
                ) : (
                  <ExactValue value={field.before} />
                )}
              </td>
              <td>
                <ExactValue value={field.proposed} />
              </td>
              {!review && (
                <td>
                  <ExactValue value={field.after} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS: Record<BatchRun["status"], string> = {
  preparing: "Reading the form",
  awaiting_approval: "Review every change",
  running: "Filling the reviewed fields",
  completed: "Fill receipt",
  stopped: "Form fill stopped",
  failed: "This form needs attention",
  expired: "Refresh this review",
};

export function FillWorkflow({
  open,
  onClose,
  onActivityChange,
  apps,
  initialAppId,
  permissions,
  loading,
  appsError,
  onRefresh,
  onPermission,
}: {
  open: boolean;
  onClose: () => void;
  onActivityChange: (active: boolean) => void;
  apps: DesktopApp[];
  initialAppId?: string;
  permissions: Permissions | null;
  loading: boolean;
  appsError: string;
  onRefresh: () => void;
  onPermission: () => void;
}) {
  const fill = useFill();
  const [draft, setDraft] = useState("");
  const [appId, setAppId] = useState("");
  const [consent, setConsent] = useState(false);
  const [validation, setValidation] = useState("");
  const [exportError, setExportError] = useState("");
  const [closing, setClosing] = useState(false);
  const source = useRef<HTMLTextAreaElement>(null);
  const appSelect = useRef<HTMLSelectElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const run = fill.run;
  const review = run?.status === "awaiting_approval";
  const executing = run?.status === "preparing" || run?.status === "running";
  const verified =
    run?.fields.filter(
      (field) =>
        field.status === "verified" ||
        (field.status === "skipped" &&
          !field.error &&
          field.after === field.proposed),
    ).length || 0;

  useEffect(() => {
    onActivityChange(fill.active || fill.busy || closing);
  }, [fill.active, fill.busy, closing, onActivityChange]);
  useEffect(() => {
    if (open && !appId && initialAppId) setAppId(initialAppId);
  }, [open, appId, initialAppId]);
  useEffect(() => {
    if (
      open &&
      (review ||
        run?.status === "completed" ||
        run?.status === "failed" ||
        run?.status === "expired" ||
        run?.status === "stopped")
    )
      heading.current?.focus({ preventScroll: true });
  }, [open, review, run?.status]);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (fill.busy || fill.active || loading) return;
    setValidation("");
    setExportError("");
    if (!apps.some((app) => app.id === appId)) {
      setValidation("Choose one open app containing the form.");
      appSelect.current?.focus();
      return;
    }
    if (!permissions?.accessibility) {
      setValidation(
        "Allow app access in System Settings, then return here to review the form.",
      );
      return;
    }
    let fields: Record<string, string>;
    try {
      fields = parseFillFields(draft);
    } catch (cause) {
      setValidation(errorMessage(cause, "Check the JSON values."));
      source.current?.focus();
      return;
    }
    if (!consent) {
      setValidation("Allow local inspection before reviewing this form.");
      consentInput.current?.focus();
      return;
    }
    await fill.prepare({ appId, fields, consent });
  }
  async function close() {
    if (fill.busy || executing || closing) return;
    if (review) {
      setClosing(true);
      const stopped = await fill.stop();
      setClosing(false);
      if (!stopped) return;
    }
    onClose();
  }
  async function exportReceipt() {
    if (!run) return;
    setExportError("");
    try {
      await nativeAPI().exportFill(run.id);
    } catch (cause) {
      setExportError(
        errorMessage(cause, "The receipt could not be exported. Try again."),
      );
    }
  }
  function edit() {
    if (fill.active || fill.busy) return;
    fill.reset();
    setConsent(false);
    setValidation("");
    setExportError("");
    requestAnimationFrame(() => source.current?.focus());
  }
  async function backToValues() {
    if (!review || fill.busy) return;
    setClosing(true);
    const stopped = await fill.stop();
    setClosing(false);
    if (stopped) {
      fill.reset();
      setConsent(false);
      requestAnimationFrame(() => source.current?.focus());
    }
  }

  if (!open) return null;
  return (
    <Dialog
      title="Fill a form"
      className="fill-dialog"
      dismissible={!fill.busy && !executing && !closing}
      onClose={() => void close()}
    >
      {!run ? (
        <form className="fill-source-form" onSubmit={prepare}>
          <div className="fill-dialog-body">
            <p className="dialog-description">
              Paste exact values. Review where each one goes, then fill the
              fields in one approved pass.
            </p>
            <label className="fill-input-label" htmlFor="fill-app">
              App containing the form
            </label>
            <div className="fill-app-row">
              <select
                ref={appSelect}
                id="fill-app"
                value={appId}
                onChange={(event) => {
                  setAppId(event.target.value);
                  setConsent(false);
                  setValidation("");
                }}
                disabled={loading || fill.busy}
              >
                <option value="">Choose an open app</option>
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                    {apps.some(
                      (other) => other.id !== app.id && other.name === app.name,
                    )
                      ? ` (${app.pid})`
                      : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                onClick={onRefresh}
                disabled={loading || fill.busy}
                aria-label="Refresh open apps"
              >
                <RefreshCw size={16} className={loading ? "spinner" : ""} />
              </button>
            </div>
            {!permissions?.accessibility && (
              <div className="permission-callout">
                <p>
                  Allow this app under Accessibility in System Settings, then
                  return here. Otto checks again automatically.
                </p>
                {permissions?.platform === "darwin" && (
                  <p>
                    After an alpha update, if Otto is already enabled, remove
                    its old Accessibility entry and add /Applications/Otto.app
                    again.
                  </p>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={onPermission}
                  disabled={loading}
                >
                  Open system permissions
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={onRefresh}
                  disabled={loading}
                >
                  Check again
                </button>
              </div>
            )}
            {appsError && (
              <p className="inline-error" role="alert">
                {appsError}
              </p>
            )}
            <div className="fill-source-heading">
              <label className="fill-input-label" htmlFor="fill-values">
                Field names and exact values
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setDraft(EXAMPLE);
                  setConsent(false);
                  setValidation("");
                  source.current?.focus();
                }}
                disabled={fill.busy}
              >
                Use example
              </button>
            </div>
            <textarea
              ref={source}
              id="fill-values"
              className="fill-json"
              data-initial-focus="true"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setConsent(false);
                setValidation("");
              }}
              placeholder={EXAMPLE}
              spellCheck={false}
              autoCapitalize="off"
              disabled={fill.busy}
              aria-describedby="fill-source-help fill-validation"
              aria-invalid={Boolean(validation)}
            />
            <p id="fill-source-help" className="field-hint">
              Up to 16 fields. Text values only. Field names must match native
              editable controls.
            </p>
            <label className="check-line fill-consent">
              <input
                ref={consentInput}
                type="checkbox"
                checked={consent}
                onChange={(event) => {
                  setConsent(event.target.checked);
                  setValidation("");
                }}
                disabled={fill.busy}
              />
              <span>
                Allow Otto to read this app locally and prepare the exact field
                changes for my review.
              </span>
            </label>
            <p
              id="fill-validation"
              className={validation ? "inline-error" : "sr-only"}
              role="alert"
            >
              {validation}
            </p>
            {fill.error && (
              <p className="inline-error" role="alert">
                {fill.error}
              </p>
            )}
          </div>
          <footer className="fill-dialog-footer">
            <span className="field-hint">
              <ShieldCheck size={13} />
              Local processing · No provider key needed
            </span>
            <button
              className="primary-button"
              type="submit"
              disabled={fill.busy || loading}
            >
              {fill.busy ? (
                <LoaderCircle size={14} className="spinner" />
              ) : (
                <FileJson size={15} />
              )}
              {fill.busy ? "Reading form…" : "Review fields"}
            </button>
          </footer>
        </form>
      ) : (
        <>
          <div className="fill-dialog-body">
            <div className="fill-run-heading">
              <h3 ref={heading} tabIndex={-1}>
                {STATUS[run.status]}
              </h3>
              <span>
                {run.app?.name ||
                  apps.find((app) => app.id === run.appId)?.name ||
                  "Selected app"}
                {run.windowTitle ? ` · ${run.windowTitle}` : ""}
              </span>
            </div>
            {executing && (
              <p className="fill-progress" role="status">
                <LoaderCircle size={15} className="spinner" />
                {run.status === "preparing"
                  ? "Reading native fields. No values are being filled."
                  : `${verified} of ${run.fields.length} field values verified.`}
              </p>
            )}
            {review && (
              <p className="fill-review-note">
                Approve these exact text changes. The target app may save edits
                automatically. Otto won’t press Submit.
              </p>
            )}
            {run.status === "completed" && (
              <p className="fill-complete" role="status">
                <Check size={16} />
                {run.verification === "native_readback"
                  ? `${verified} of ${run.fields.length} native field values matched the approved text.`
                  : "The fill finished. Review the field results below."}
              </p>
            )}
            {(run.error || run.result) && (
              <p
                className={run.error ? "inline-error" : "fill-result"}
                role={run.error ? "alert" : undefined}
              >
                {run.error || run.result}
              </p>
            )}
            {run.status !== "preparing" && run.fields.length > 0 && (
              <FieldReview run={run} />
            )}
            {!fill.active && (
              <p className="fill-receipt-note">
                Verification checks native field values. It does not establish
                that the app saved or submitted the form.
              </p>
            )}
            {!fill.active && (
              <p className="fill-metrics" aria-label="Execution counts">
                <span>
                  {run.metrics.nativeActions} native{" "}
                  {run.metrics.nativeActions === 1 ? "action" : "actions"}
                </span>
                <span>
                  {run.metrics.observations}{" "}
                  {run.metrics.observations === 1
                    ? "observation"
                    : "observations"}
                </span>
                <span>{run.metrics.modelCalls} model calls</span>
              </p>
            )}
            {fill.error && (
              <p className="inline-error" role="alert">
                {fill.error}
              </p>
            )}
            {exportError && (
              <p className="inline-error" role="alert">
                {exportError}
              </p>
            )}
          </div>
          <footer className="fill-dialog-footer">
            {review ? (
              <>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void (fill.busy ? fill.stop() : backToValues())
                  }
                  disabled={closing}
                >
                  {fill.busy ? (
                    <Square size={12} fill="currentColor" />
                  ) : (
                    <ArrowLeft size={14} />
                  )}
                  {fill.busy ? "Stop form fill" : "Edit values"}
                </button>
                <button
                  className="primary-button"
                  onClick={() => void fill.approve()}
                  disabled={fill.busy || closing || !run.approvalId}
                >
                  {fill.busy ? (
                    <LoaderCircle size={14} className="spinner" />
                  ) : (
                    <Check size={14} />
                  )}
                  {fill.busy
                    ? "Starting…"
                    : `Fill ${run.fields.length} ${run.fields.length === 1 ? "field" : "fields"}`}
                </button>
              </>
            ) : executing ? (
              <>
                <span className="field-hint">
                  {run.status === "preparing"
                    ? "Preparing your review"
                    : "Applying the reviewed text values."}
                </span>
                <button
                  className="secondary-button"
                  onClick={() => void fill.stop()}
                >
                  <Square size={12} fill="currentColor" />
                  Stop form fill
                </button>
              </>
            ) : (
              <>
                <button className="text-button" onClick={exportReceipt}>
                  <Download size={13} />
                  Export receipt
                </button>
                <div className="button-row">
                  <button className="secondary-button" onClick={edit}>
                    {run.status === "completed"
                      ? "New form fill"
                      : "Edit and review again"}
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void close()}
                  >
                    Done
                    <Check size={14} />
                  </button>
                </div>
              </>
            )}
          </footer>
        </>
      )}
    </Dialog>
  );
}
