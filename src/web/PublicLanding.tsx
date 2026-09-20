import { useState } from "react";
import {
  AppWindow,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  MousePointer2,
  Mic,
  ShieldCheck,
} from "lucide-react";
import { ExternalLink } from "../components/ExternalLink";
import { HelpDialog } from "../native/HelpDialog";
import "./web.css";

const SOURCE_URL = "https://github.com/NobleSpartan6/otto";

export function PublicLanding() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function share() {
    try {
      await navigator.clipboard.writeText(
        new URL(".", window.location.href).href,
      );
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Copy this page’s address from your browser to share Otto.");
    }
  }
  return (
    <div className="public-site">
      <header className="public-header">
        <a href="./" className="workspace-brand" aria-label="Otto home">
          otto<span>*</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="./agents.html">For agents <ArrowUpRight size={15} /></a>
          <ExternalLink href={SOURCE_URL}>
            GitHub
            <ArrowUpRight size={15} />
          </ExternalLink>
        </nav>
      </header>
      <main className="public-main">
        <section className="public-intro">
          <h1>
            Your computer.
            <br />A little more capable.
          </h1>
          <p className="public-description">
            An open-source computer-use agent for Mac and Windows. Give Otto a
            task in the apps you already use, and review each move.
          </p>
          <div className="public-actions">
            <ExternalLink
              className="primary-button"
              href={`${SOURCE_URL}/releases`}
            >
              <ArrowDownToLine size={17} />
              Get the desktop alpha
              <ArrowUpRight size={15} />
            </ExternalLink>
            <ExternalLink
              className="text-button"
              href={`${SOURCE_URL}#getting-started`}
            >
              Read the setup guide
              <ArrowUpRight size={14} />
            </ExternalLink>
          </div>
          <p className="release-note">
            Alpha builds without publisher signing. Read the release notes before installing.
          </p>
          <a className="public-agent-link" href="./agents.html">
            <span><strong>Already working with a coding agent?</strong><span>Connect Otto’s native tools. Explore the measured method.</span></span>
            <ArrowUpRight size={19} />
          </a>
          <div className="public-principles">
            <div>
              <ShieldCheck size={18} />
              <span>
                <strong>Always your call.</strong>
                <p>See the next action before it runs. Stop any time.</p>
              </span>
            </div>
            <div>
              <Check size={18} />
              <span>
                <strong>Review once. Verify every field.</strong>
                <p>Apply exact native form values with one review and no model calls during the fill.</p>
              </span>
            </div>
            <div>
              <Mic size={18} />
              <span>
                <strong>Say what you need.</strong>
                <p>Optional native dictation turns speech into an editable task. You decide when to start.</p>
              </span>
            </div>
            <div>
              <KeyRound size={18} />
              <span>
                <strong>Your keys. Your apps.</strong>
                <p>
                  Start with TypeSafe Jev. Add an OpenAI planner if you need it.
                </p>
              </span>
            </div>
          </div>
        </section>
        <aside className="public-product">
          <div className="product-caption">
            <span />
            <span />
            <span />
            <p>Otto for desktop</p>
          </div>
          <div className="public-product-content">
            <div className="public-pointer">
              <AppWindow size={72} strokeWidth={1} />
              <MousePointer2 size={28} strokeWidth={1.5} />
            </div>
            <h2>
              A little direction.
              <br />A lot done.
            </h2>
            <p>
              Choose the apps.
              <br />
              Give a clear task.
              <br />
              Keep a hand on every step.
            </p>
            <div className="public-platforms">
              <span>macOS</span>
              <span>Windows</span>
              <span>Open source</span>
            </div>
          </div>
        </aside>
      </main>
      <footer className="public-footer">
        <span>
          Guided decisions powered by{" "}
          <ExternalLink href="https://docs.typesafe.ai/introduction">
            TypeSafe Jev
          </ExternalLink>
          .
        </span>
        <div>
          <button onClick={() => setHelpOpen(true)}>How it works</button>
          <ExternalLink
            href={`${SOURCE_URL}/blob/main/docs/developer-tools.md`}
          >
            Developer tools
            <ArrowUpRight size={12} />
          </ExternalLink>
          <button onClick={share}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Link copied" : "Share Otto"}
          </button>
        </div>
        {copyError && <p role="status">{copyError}</p>}
      </footer>
      {helpOpen && (
        <HelpDialog sourceUrl={SOURCE_URL} onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
}
