import { useEffect, useRef, useState } from "react";
import type { BatchInput, BatchRun } from "../../shared/batch";
import { errorMessage, nativeAPI } from "../api";

export function isFillActive(run: BatchRun | null) {
  return Boolean(
    run && ["preparing", "awaiting_approval", "running"].includes(run.status),
  );
}

export function useFill() {
  const [run, setRun] = useState<BatchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const generation = useRef(0);
  const currentRun = useRef<BatchRun | null>(null);
  const pending = useRef(false);
  const active = isFillActive(run);
  const runId = run?.id;

  useEffect(() => {
    if (!runId || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const revision = generation.current;
      try {
        const next = await nativeAPI().batch(runId!);
        if (!cancelled && revision === generation.current) {
          currentRun.current = next;
          setRun(next);
          setPollError("");
        }
      } catch (cause) {
        if (!cancelled && revision === generation.current)
          setPollError(
            errorMessage(
              cause,
              "Unable to refresh this form fill. The last known state is shown.",
            ),
          );
      } finally {
        if (!cancelled) timer = setTimeout(poll, 800);
      }
    }
    timer = setTimeout(poll, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, active]);

  async function update(operation: () => Promise<BatchRun>) {
    const revision = ++generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    setPollError("");
    try {
      const next = await operation();
      if (revision !== generation.current) return false;
      generation.current++;
      currentRun.current = next;
      setRun(next);
      pending.current = false;
      setBusy(false);
      return true;
    } catch (cause) {
      if (revision === generation.current)
        setError(
          errorMessage(
            cause,
            "The form fill could not continue. Please try again.",
          ),
        );
      return false;
    } finally {
      if (revision === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function prepare(input: BatchInput) {
    if (isFillActive(currentRun.current) || pending.current)
      return Promise.resolve(false);
    currentRun.current = null;
    setRun(null);
    return update(() => nativeAPI().prepareFill(input));
  }
  function approve() {
    const run = currentRun.current;
    if (
      !run?.approvalId ||
      run.status !== "awaiting_approval" ||
      pending.current
    )
      return Promise.resolve(false);
    return update(() => nativeAPI().approveFill(run.id, run.approvalId!));
  }
  function stop() {
    const run = currentRun.current;
    if (!run || !isFillActive(run)) return Promise.resolve(true);
    return update(() => nativeAPI().stopFill(run.id));
  }
  function reset() {
    if (isFillActive(currentRun.current) || pending.current) return;
    generation.current++;
    currentRun.current = null;
    setRun(null);
    setError("");
    setPollError("");
  }
  return {
    run,
    active,
    busy,
    error: error || pollError,
    prepare,
    approve,
    stop,
    reset,
  };
}
