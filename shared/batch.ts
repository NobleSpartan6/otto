import type { DesktopApp } from "./types.js";

export interface BatchInput { appId: string; fields: Record<string, string>; consent: boolean }
export type BatchStatus = "preparing" | "awaiting_approval" | "running" | "completed" | "stopped" | "failed" | "expired";
export interface BatchField {
  label: string;
  before: string;
  proposed: string;
  after?: string;
  status: "pending" | "verified" | "failed" | "skipped";
  error?: string;
}
export interface BatchRun {
  id: string;
  kind: "exact_fill";
  status: BatchStatus;
  appId: string;
  app?: DesktopApp;
  windowTitle?: string;
  createdAt: string;
  expiresAt?: string;
  approvalId?: string;
  fields: BatchField[];
  metrics: { observations: number; nativeActions: number; modelCalls: 0 };
  error?: string;
  result?: string;
  verification?: "native_readback";
}
