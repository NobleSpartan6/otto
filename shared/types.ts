export interface DesktopApp {
  id: string;
  name: string;
  pid: number;
}
export interface Permissions {
  accessibility: boolean;
  screenCapture: boolean;
  platform: string;
}
export interface NativeControl {
  id: string;
  /** Helper-owned identity retained only while this exact native element survives. */
  identity?: string;
  role: string;
  label: string;
  value?: string;
  enabled: boolean;
  actions: string[];
  editable?: boolean;
  sensitive?: boolean;
  source?: "accessibility" | "ocr";
  bounds?: { x: number; y: number; width: number; height: number };
}
export interface NativeSnapshot {
  snapshotId: string;
  app: DesktopApp;
  title: string;
  text: string;
  controls: NativeControl[];
  capturedAt: string;
  /** Helper-issued identity for the exact window, stable across fresh observations. */
  windowToken?: string;
  /** Opaque identity for a native document attribute, when the app exposes one. */
  documentToken?: string;
  screenshot?: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
  screenshotSize?: { width: number; height: number };
  protectedBounds?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}
export type ActionKind =
  "press" | "fill" | "scroll" | "key" | "activate" | "finish" | "blocked";
export interface NativeAction {
  id: string;
  kind: ActionKind;
  label: string;
  appId: string;
  targetId?: string;
  value?: string;
  nativeAction?: string;
  snapshotId: string;
}
export interface RunEvent {
  id: string;
  kind: string;
  message: string;
  timestamp: string;
  confidence?: number;
  latencyMs?: number;
  model?: string;
}
export type RunStatus =
  | "running"
  | "awaiting_approval"
  | "awaiting_confirmation"
  | "completed"
  | "stopped"
  | "failed"
  | "limit_reached"
  | "blocked";
export interface JevRequestMetric {
  id: string;
  requestedModel: string;
  model: string | null;
  startedAt: string;
  completedAt: string | null;
  outcome: "pending" | "succeeded" | "http_error" | "invalid_response" | "cancelled" | "timeout" | "network_error";
  responseReceived: boolean;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Client-observed request elapsed time, including failed requests; not model inference time. */
  latencyMs: number | null;
}
export interface OttoRun {
  id: string;
  goal: string;
  appIds: string[];
  status: RunStatus;
  step: number;
  mode?: "hybrid" | "jev";
  subgoal?: string;
  plannerCalls?: number;
  decisionCalls?: number;
  /** Measured responses only; failed/cancelled requests may have unreported usage. */
  metrics?: {
    /** Subtotal of reported input usage; use jev.inputTokens for a complete total. */
    jevInputTokens: number;
    plannerInputTokens: number | null;
    plannerOutputTokens: number | null;
    modelLatencyMs: number;
    jev?: {
      attemptedRequests: number;
      receivedResponses: number;
      unknownUsageRequests: number;
      /** Custom decider invocations that did not report request lifecycle telemetry. */
      untrackedCalls: number;
      reportedInputTokens: number;
      reportedOutputTokens: number;
      /** Null if any attempt is pending or did not report the corresponding counter. */
      inputTokens: number | null;
      outputTokens: number | null;
      usageComplete: boolean;
      requestLatencyMs: number;
      requests: JevRequestMetric[];
    };
  };
  maxSteps: number;
  createdAt: string;
  events: RunEvent[];
  snapshot?: NativeSnapshot;
  pendingAction?: {
    id: string;
    label: string;
    reason: string;
    appName?: string;
    operation?: ActionKind;
    target?: string;
    value?: string;
  };
  result?: string;
  error?: string;
  verification?: "user_confirmed";
}
export interface OttoConfig {
  desktop: boolean;
  platform: string;
  version: string;
  configured: boolean;
  plannerConfigured?: boolean;
  sourceUrl: string;
  maxSteps: number;
}
export interface StartInput {
  goal: string;
  appIds: string[];
  apiKey?: string;
  consent: boolean;
  mode?: "hybrid" | "jev";
  plannerScreenshot?: boolean;
}
export interface OttoAPI {
  config(): Promise<OttoConfig>;
  apps(): Promise<{ apps: DesktopApp[]; permissions: Permissions }>;
  permissions(kind: "accessibility" | "screenCapture"): Promise<Permissions>;
  start(input: StartInput): Promise<OttoRun>;
  run(id: string): Promise<OttoRun>;
  approve(id: string, actionId: string): Promise<OttoRun>;
  confirm(id: string): Promise<OttoRun>;
  stop(id: string): Promise<OttoRun>;
  saveKey(apiKey: string, remember: boolean): Promise<void>;
  clearKey(): Promise<void>;
  savePlannerKey(apiKey: string, remember: boolean): Promise<void>;
  clearPlannerKey(): Promise<void>;
  exportRun(id: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  prepareFill(input: import("./batch.js").BatchInput): Promise<import("./batch.js").BatchRun>;
  batch(id: string): Promise<import("./batch.js").BatchRun>;
  approveFill(id: string, approvalId: string): Promise<import("./batch.js").BatchRun>;
  stopFill(id: string): Promise<import("./batch.js").BatchRun>;
  exportFill(id: string): Promise<boolean>;
  voiceStart(): Promise<{ status: "listening" | "unavailable"; message?: string }>;
  voiceStop(): Promise<{ text: string }>;
  voiceCancel(): Promise<void>;
  onVoiceEnded?(listener: (event: { cancelled: boolean }) => void): () => void;
}
export interface NativeDriver {
  apps(): Promise<{ apps: DesktopApp[]; permissions: Permissions }>;
  configure(appIds: string[]): Promise<void>;
  observe(appId: string): Promise<NativeSnapshot>;
  act(action: NativeAction): Promise<void>;
  cancel(): void;
}
