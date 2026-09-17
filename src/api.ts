import type { OttoAPI, OttoRun } from "../shared/types";
export type {
  DesktopApp,
  OttoConfig,
  OttoRun,
  Permissions,
} from "../shared/types";

declare global {
  interface Window {
    otto?: OttoAPI;
  }
}

export const isActive = (run: OttoRun | null) =>
  run?.status === "running" ||
  run?.status === "awaiting_approval" ||
  run?.status === "awaiting_confirmation";
export function nativeAPI(): OttoAPI {
  if (!window.otto)
    throw new Error("Open the Otto desktop app to use this feature.");
  return window.otto;
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error
    ? cause.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      )
    : fallback;
}
