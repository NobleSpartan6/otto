import type { EvidenceProbe, EvidenceProbeKind, EvidenceRequest } from "../core/evidence-policy.js";

export const EVIDENCE_SUITE_VERSION = "otto-synthetic-evidence-v1";
export interface SyntheticEvidenceCase {
  id: string;
  partition: "dev" | "validation";
  family: string;
  template: string;
  request: EvidenceRequest;
  /** Authored fixture facts and annotations. Never include these in a selector request. */
  hidden: {
    oracle: { claimTruth: "true" | "false" | "unknown"; state: Record<string, string> };
    outcomes: Record<string, { evidence: string; resolution: "supports" | "contradicts" | "unresolved" | "host_required" }>;
  };
}
const probe = (id: string, kind: EvidenceProbeKind, description: string, cost: number, available = true): EvidenceProbe =>
  ({ id, kind, description, cost, available, appId: "fixture", claimIds: ["claim"] });
const request = (description: string, summary: string, probes: EvidenceProbe[]): EvidenceRequest =>
  ({ claim: { id: "claim", description }, context: { appId: "fixture", summary }, probes });
const host = () => probe("host", "ask_host", "Return unresolved claim to the host for missing scope, permission, or authoritative evidence.", 100);

/** Public-to-the-code, hand-authored synthetic scenarios: validation is not a secret holdout or native execution. */
export const EVIDENCE_CASES: readonly SyntheticEvidenceCase[] = [
  { id: "dev-project-literal", partition: "dev", family: "project_form", template: "project-name-readback",
    request: request("The Project name field equals Otto Demo.", "One uniquely identified editable field; current document identity is already established.", [
      probe("value", "read_value", "Read the complete current Project name field value.", 1),
      probe("tree", "inspect_tree", "Read the full selected window control tree.", 8), host()]),
    hidden: { oracle: { claimTruth: "true", state: { projectName: "Otto Demo" } }, outcomes: {
      value: { evidence: "Project name=Otto Demo", resolution: "supports" }, tree: { evidence: "Full tree contains Project name=Otto Demo", resolution: "supports" },
      host: { evidence: "No further evidence acquired.", resolution: "host_required" } } } },
  { id: "dev-note-duplicate", partition: "dev", family: "note_form", template: "duplicate-label-discovery",
    request: request("The intended Notes field equals Final draft.", "Two Notes controls were previously seen; the intended field cannot yet be uniquely resolved.", [
      probe("value", "read_value", "Read Notes after its native target has been uniquely resolved.", 1, false),
      probe("tree", "inspect_tree", "Read control identities and surrounding labels to distinguish the two Notes fields.", 5), host()]),
    hidden: { oracle: { claimTruth: "false", state: { intendedNotes: "Old draft", otherNotes: "Final draft" } }, outcomes: {
      tree: { evidence: "Main Notes=Old draft; Archive Notes=Final draft.", resolution: "contradicts" },
      host: { evidence: "Needs host clarification if the intended target remains ambiguous.", resolution: "host_required" } } } },
  { id: "dev-draft-unsaved", partition: "dev", family: "draft_editor", template: "buffer-vs-persistence",
    request: request("The draft has been saved to persistent storage.", "The visible buffer has the intended text. Only native field/tree/document identity reads are available; none exposes disk persistence.", [
      probe("value", "read_value", "Read the text currently visible in the editor buffer, not disk state.", 1),
      probe("document", "read_document_identity", "Read the editor's current document identity, not persistence status.", 2), host()]),
    hidden: { oracle: { claimTruth: "false", state: { buffer: "New text", disk: "Old text", document: "draft.txt" } }, outcomes: {
      value: { evidence: "Buffer=New text", resolution: "unresolved" }, document: { evidence: "Document=draft.txt", resolution: "unresolved" },
      host: { evidence: "No permitted persistence check exists.", resolution: "host_required" } } } },
  { id: "dev-startup-tree", partition: "dev", family: "startup_form", template: "incomplete-accessibility-tree",
    request: request("The form is ready for inspecting the Test command field.", "Initial tree is incomplete; there is no resolved field handle. No write is being proposed.", [
      probe("value", "read_value", "Read Test command through a resolved handle.", 1, false),
      probe("tree", "inspect_tree", "Refresh the selected window tree to determine whether Test command exists and is editable.", 4), host()]),
    hidden: { oracle: { claimTruth: "true", state: { control: "Test command", editable: "true", value: "npm test" } }, outcomes: {
      tree: { evidence: "Unique enabled editable Test command field is present.", resolution: "supports" },
      host: { evidence: "No tree acquired.", resolution: "host_required" } } } },
  { id: "validation-ledger-document", partition: "validation", family: "ledger_workspace", template: "same-value-wrong-record",
    request: request("The account code was entered into the requested September ledger.", "Account code matches, but two ledger documents exist. The active document has not been identified since the window changed.", [
      probe("value", "read_value", "Read the current Account code field; this does not identify its document.", 1),
      probe("document", "read_document_identity", "Read the selected document identity and compare it with September ledger.", 2), host()]),
    hidden: { oracle: { claimTruth: "false", state: { requestedDocument: "September ledger", actualDocument: "August ledger", accountCode: "AC-42" } }, outcomes: {
      value: { evidence: "Account code=AC-42", resolution: "unresolved" }, document: { evidence: "Current document=August ledger", resolution: "contradicts" },
      host: { evidence: "No identity evidence acquired.", resolution: "host_required" } } } },
  { id: "validation-profile-stale-toast", partition: "validation", family: "profile_settings", template: "stale-success-vs-current-value",
    request: request("Display name currently equals Ada Lovelace.", "An old success toast is still visible. A uniquely identified native Display name field can be read now.", [
      probe("tree", "inspect_tree", "Read a tree containing the old toast and field values.", 8),
      probe("value", "read_value", "Read the full current Display name value rather than relying on the success toast.", 1), host()]),
    hidden: { oracle: { claimTruth: "false", state: { displayName: "Previous name", toast: "Saved", toastEpoch: "earlier" } }, outcomes: {
      value: { evidence: "Display name=Previous name", resolution: "contradicts" }, tree: { evidence: "Toast=Saved; Display name=Previous name", resolution: "contradicts" },
      host: { evidence: "No fresh value acquired.", resolution: "host_required" } } } },
  { id: "validation-build-literal", partition: "validation", family: "build_configuration", template: "full-command-not-preview",
    request: request("The build command equals npm run test -- --runInBand.", "The compact preview shows npm run test. One resolved native field offers a complete value read; the preview is truncated.", [
      probe("document", "read_document_identity", "Read the build configuration document identity, not the command value.", 1),
      probe("value", "read_value", "Read the complete build command including characters omitted by the preview.", 2), host()]),
    hidden: { oracle: { claimTruth: "false", state: { command: "npm run test -- --watch", preview: "npm run test" } }, outcomes: {
      document: { evidence: "Document=Local build configuration", resolution: "unresolved" }, value: { evidence: "Command=npm run test -- --watch", resolution: "contradicts" },
      host: { evidence: "No full value acquired.", resolution: "host_required" } } } },
  { id: "validation-mail-unsupported", partition: "validation", family: "mail_delivery", template: "external-delivery-not-visible",
    request: request("The recipient received the email.", "The draft window is closed. No delivery receipt API or inbox access is authorized; observing another app is outside scope.", [
      probe("tree", "inspect_tree", "Inspect the former draft window, which is no longer available.", 1, false),
      { ...probe("inbox", "inspect_tree", "Read recipient inbox state.", 2), appId: "outside" }, host()]),
    hidden: { oracle: { claimTruth: "unknown", state: { delivery: "not observable under permitted scope" } }, outcomes: {
      host: { evidence: "Requires an authorized delivery evidence source.", resolution: "host_required" } } } },
];

export const EVIDENCE_LIMITATIONS = "Eight hand-authored synthetic scenarios with separate development/validation task families. All templates and outcomes are visible in source. This is not a hidden benchmark, native execution, a calibrated verifier, or evidence of cost/latency savings. Hidden outcome annotations are supplied only to the offline grader, never the selector.";
