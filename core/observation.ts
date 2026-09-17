import type { NativeSnapshot } from "../shared/types.js";
import { isSensitive } from "./candidates.js";

/** Selected-app text is useful evidence. Strip known credentials before bounding it. */
export function observationText(
  snapshot: NativeSnapshot,
  secrets: string[] = [],
): string {
  let text = snapshot.text.slice(0, 32_000);
  const protectedValues = snapshot.controls
    .filter(isSensitive)
    .map((control) => control.value)
    .filter((value): value is string => Boolean(value));
  for (const secret of [...secrets, ...protectedValues]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "[redacted API key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passcode|secret)\s*[:=]\s*["']?[^\s"']+/gi,
      "$1: [redacted]",
    )
    .slice(0, 16_000);
}
