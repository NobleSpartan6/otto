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
          Otto works in desktop apps you choose. It proposes one action at a
          time, and you approve each step.
        </p>
        <ol>
          <li>
            <strong>Connect your key.</strong>
            <p>
              Start with TypeSafe Jev. Add an OpenAI planner only if you want
              Hybrid mode.
            </p>
          </li>
          <li>
            <strong>Choose the apps and write a task.</strong>
            <p>
              For Jev-only typing tasks, put the exact text in quotes. Try a
              blank document first.
            </p>
          </li>
          <li>
            <strong>Review what happens next.</strong>
            <p>
              Otto shows the intended app, control, and text. Stop any time. You
              confirm when the result is complete.
            </p>
          </li>
        </ol>
        <div className="info-note">
          With your consent, selected-app text and controls go to TypeSafe.
          Hybrid mode also shares text with OpenAI. Screenshots stay local
          unless you separately allow visual planning.
        </div>
        <p className="field-hint">
          Otto is an unsigned alpha for macOS and Windows. Some apps expose
          fewer usable controls.
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
