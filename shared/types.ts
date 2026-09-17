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
    jevInputTokens: number;
    plannerInputTokens: number | null;
    plannerOutputTokens: number | null;
    modelLatencyMs: number;
  };
  maxSteps: number;
  createdAt: string;
  events: RunEvent[];
  snapshot?: NativeSnapshot;
  pendingAction?: { id: string; label: string; reason: string };
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
}
export interface NativeDriver {
  apps(): Promise<{ apps: DesktopApp[]; permissions: Permissions }>;
  configure(appIds: string[]): Promise<void>;
  observe(appId: string): Promise<NativeSnapshot>;
  act(action: NativeAction): Promise<void>;
  cancel(): void;
}
