import { Check, ExternalLink as ExternalLinkIcon } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { ExternalLink } from "../components/ExternalLink";

export function HelpDialog({
  sourceUrl,
  onClose,
}: {
  sourceUrl: string;
  onClose: () => void;
}) {
  return (
    <Dialog title="A little direction. A lot done." onClose={onClose}>
      <div className="help-content">
        <p>
          Choose a guided task or fill a form with exact values. Otto works only
          in the apps you select.
        </p>
        <ol>
          <li>
            <strong>Choose how to work.</strong>
            <p>
              Guided tasks use your TypeSafe key. Fill form reads and edits
              reviewed native fields locally, without an API key.
            </p>
          </li>
          <li>
            <strong>Write it, or dictate it.</strong>
            <p>
              The microphone adds speech to your draft. Stop to review the text;
              nothing starts automatically. Dictation stops after 40 seconds and
              uses system speech recognition.
            </p>
          </li>
          <li>
            <strong>Review the exact changes.</strong>
            <p>
              Approve each guided action, or approve one form plan showing every
              field and value. For Jev-only typing tasks, put the exact text in
              quotes. Stop any time.
            </p>
          </li>
          <li>
            <strong>Check the evidence.</strong>
            <p>
              You confirm guided task completion. A form receipt reports native
              value checks; it does not establish that the app saved or
              submitted the form. Edits may autosave in the target app.
            </p>
          </li>
        </ol>
        <div className="info-note">
          With your consent, guided tasks share selected-app text and controls
          with TypeSafe. Hybrid mode also shares text with OpenAI. Screenshots
          stay local unless you separately allow visual planning. Form fills and
          dictation don’t need provider keys.
        </div>
        <p className="field-hint">
          On macOS, enable this app under Accessibility in System Settings.
          Screen Recording enables previews. After an alpha update, if Otto is
          already enabled but access stays off, remove its old Accessibility
          entry and add /Applications/Otto.app again. Otto rechecks when you
          return.
        </p>
        <div className="dialog-footer">
          <div className="help-links">
            <ExternalLink href={`${sourceUrl}#getting-started`}>
              Setup guide
              <ExternalLinkIcon size={12} />
            </ExternalLink>
            <ExternalLink
              href={`${sourceUrl}/blob/main/docs/developer-tools.md`}
            >
              Developer tools
              <ExternalLinkIcon size={12} />
            </ExternalLink>
          </div>
          <button className="primary-button" onClick={onClose}>
            Got it
            <Check size={14} />
          </button>
        </div>
      </div>
    </Dialog>
  );
}
