import { useState } from "react";
import { AppWindow, Check, RefreshCw, Search } from "lucide-react";
import { type DesktopApp, type Permissions } from "../api";
import { Dialog } from "../components/Dialog";

interface AppPickerProps {
  apps: DesktopApp[];
  selected: string[];
  permissions: Permissions | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onPermission: () => void;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}

export function AppPicker({
  apps,
  selected,
  permissions,
  loading,
  error,
  onRefresh,
  onPermission,
  onApply,
  onClose,
}: AppPickerProps) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(selected);
  const visible = apps.filter((app) =>
    app.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()),
  );
  const validIds = chosen.filter((id) => apps.some((app) => app.id === id));
  const duplicates = new Set(
    apps
      .filter((app, index) =>
        apps.some(
          (other, otherIndex) =>
            otherIndex !== index && other.name === app.name,
        ),
      )
      .map((app) => app.name),
  );

  return (
    <Dialog title="Choose your apps" className="apps-dialog" onClose={onClose}>
      <p className="dialog-description">
        Otto can work in up to four open apps. You choose which ones.
      </p>
      <div className="picker-toolbar">
        <label className="search-field">
          <Search size={16} />
          <span className="sr-only">Search open apps</span>
          <input
            data-initial-focus="true"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search open apps…"
            type="search"
          />
        </label>
        <button
          className="icon-button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh open apps"
          aria-label="Refresh open apps"
        >
          <RefreshCw size={16} className={loading ? "spinner" : ""} />
        </button>
      </div>
      {permissions && !permissions.accessibility && (
        <div className="permission-callout">
          <p>Allow Accessibility so Otto can read and use app controls.</p>
          <button
            className="text-button"
            onClick={onPermission}
            disabled={loading}
          >
            Open system permissions
          </button>
          <button
            className="text-button"
            onClick={onRefresh}
            disabled={loading}
          >
            Check again
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="picker-list"
        role="group"
        aria-label="Apps Otto can use"
        aria-describedby="app-selection-hint"
      >
        {loading && !apps.length ? (
          <p className="picker-empty" role="status">
            Finding your open apps…
          </p>
        ) : visible.length ? (
          visible.map((app) => {
            const checked = chosen.includes(app.id);
            return (
              <label
                className={`picker-app ${checked ? "is-selected" : ""}`}
                key={app.id}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && validIds.length >= 4}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setChosen((current) =>
                      checked
                        ? [...current, app.id]
                        : current.filter((id) => id !== app.id),
                    );
                  }}
                />
                <span className="app-symbol">
                  <AppWindow size={19} />
                </span>
                <span className="picker-app-name">
                  {app.name}
                  {duplicates.has(app.name) && <small>Process {app.pid}</small>}
                </span>
                <span className="picker-check" aria-hidden="true">
                  {checked && <Check size={14} />}
                </span>
              </label>
            );
          })
        ) : (
          <p className="picker-empty">
            {query
              ? "No apps match that search."
              : "Open an app, then refresh this list."}
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <span id="app-selection-hint" className="field-hint" role="status">
          {loading
            ? "Refreshing open apps…"
            : `${validIds.length} of 4 apps selected`}
        </span>
        <button
          className="primary-button"
          disabled={loading || Boolean(error)}
          onClick={() => onApply(validIds)}
        >
          {validIds.length
            ? `Use ${validIds.length === 1 ? "this app" : `${validIds.length} apps`}`
            : "Done"}
          <Check size={15} />
        </button>
      </div>
    </Dialog>
  );
}
