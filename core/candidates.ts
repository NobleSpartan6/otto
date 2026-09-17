import { randomUUID } from "node:crypto";
import type {
  DesktopApp,
  NativeAction,
  NativeControl,
  NativeSnapshot,
} from "../shared/types.js";

export interface GeneratedFill {
  appId: string;
  title: string;
  role: string;
  label: string;
  text: string;
}
export const MAX_CANDIDATES = 64;

function prioritize(
  candidates: NativeAction[],
  snapshot: NativeSnapshot,
  goal: string,
): NativeAction[] {
  if (candidates.length <= MAX_CANDIDATES) return candidates;
  const words = new Set(
    goal.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  );
  const rank = (action: NativeAction) => {
    const control = snapshot.controls.find(
      (control) => control.id === action.targetId,
    );
    const tokens = new Set(
      `${control?.label ?? ""} ${control?.role ?? ""}`
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    );
    return (
      [...tokens].filter((word) => word.length > 2 && words.has(word)).length *
        10 +
      (action.kind === "fill" &&
      /\b(write|type|enter|fill|draft|search)\b/i.test(goal)
        ? 4
        : 0)
    );
  };
  const ranked = candidates
    .map((action, order) => ({ action, order, score: rank(action) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((item) => item.action);
  const retained = new Set(
    candidates
      .filter((action) =>
        ["finish", "blocked", "activate", "key"].includes(action.kind),
      )
      .map((action) => action.id),
  );
  // Reserve a useful target for every concrete text value and scroll direction,
  // so numerous press targets cannot remove all typing or navigation options.
  const fills = new Set<string | undefined>();
  const scrolls = new Set<string | undefined>();
  for (const action of ranked) {
    if (action.kind === "fill" && !fills.has(action.value)) {
      fills.add(action.value);
      retained.add(action.id);
    }
    if (action.kind === "scroll" && !scrolls.has(action.nativeAction)) {
      scrolls.add(action.nativeAction);
      retained.add(action.id);
    }
  }
  for (const action of ranked) {
    if (retained.size >= MAX_CANDIDATES) break;
    retained.add(action.id);
  }
  return candidates.filter((action) => retained.has(action.id));
}

export function isSensitive(control: NativeControl): boolean {
  return (
    control.sensitive === true ||
    /password|secure.?text/i.test(control.role) ||
    /\b(password|passcode|one.time code|verification code|security code|cvv|credit card|api key|private key|recovery phrase)\b/i.test(
      control.label,
    )
  );
}

export function literalValues(goal: string): string[] {
  const values: string[] = [];
  const quotes =
    /"([^"\r\n]{1,2000})"|“([^”\r\n]{1,2000})”|(?:^|\s)'([^'\r\n]{1,2000})'(?=\s|[.,;!?]|$)/g;
  for (const match of goal.matchAll(quotes)) {
    const value = match[1] ?? match[2] ?? match[3]!;
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

export function buildCandidates(
  snapshot: NativeSnapshot,
  apps: DesktopApp[],
  goal: string,
  drafts: GeneratedFill[] = [],
  compose = false,
): NativeAction[] {
  const candidates: NativeAction[] = [];
  const add = (action: Omit<NativeAction, "id" | "snapshotId">) => {
    candidates.push({
      ...action,
      id: randomUUID(),
      snapshotId: snapshot.snapshotId,
    });
  };
  const values = literalValues(goal);
  for (const control of snapshot.controls) {
    if (!control.enabled || isSensitive(control)) continue;
    const label = control.label || control.role;
    const base = { appId: snapshot.app.id, targetId: control.id };
    if (control.actions.includes("press"))
      add({
        ...base,
        kind: "press",
        nativeAction: "press",
        label: `Press ${label}`,
      });
    if (control.editable && control.actions.includes("fill")) {
      const matchingDrafts = drafts.filter(
        (draft) =>
          draft.appId === snapshot.app.id &&
          draft.title === snapshot.title &&
          draft.role === control.role &&
          draft.label === control.label &&
          snapshot.controls.filter(
            (other) =>
              other.role === control.role && other.label === control.label,
          ).length === 1,
      );
      for (const value of new Set([
        ...values,
        ...matchingDrafts.map((draft) => draft.text),
      ])) {
        add({
          ...base,
          kind: "fill",
          nativeAction: "fill",
          value,
          label: `Enter ${JSON.stringify(value)} in ${label}`,
        });
      }
      if (compose)
        add({
          ...base,
          kind: "fill",
          nativeAction: "fill",
          label: `Compose and enter text in ${label}`,
        });
    }
    for (const direction of ["scrollUp", "scrollDown"]) {
      if (control.actions.includes(direction))
        add({
          ...base,
          kind: "scroll",
          nativeAction: direction,
          label: `Scroll ${direction === "scrollUp" ? "up" : "down"} in ${label}`,
        });
    }
  }
  for (const app of apps) {
    if (app.id !== snapshot.app.id)
      add({ kind: "activate", appId: app.id, label: `Switch to ${app.name}` });
  }
  for (const key of ["Enter", "Escape", "Tab"])
    add({
      kind: "key",
      appId: snapshot.app.id,
      value: key.toLowerCase(),
      label: `Press ${key}`,
    });
  add({
    kind: "finish",
    appId: snapshot.app.id,
    label: "Finish: ask the user to verify the requested outcome",
  });
  add({
    kind: "blocked",
    appId: snapshot.app.id,
    label: "Stop: no available action can advance the goal",
  });
  return prioritize(candidates, snapshot, goal);
}
