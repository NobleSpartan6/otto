import { useEffect, useRef, useState } from "react";
import { errorMessage, isActive, nativeAPI, type OttoRun } from "./api";

export function useRun() {
  const [run, setRun] = useState<OttoRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollingError, setPollingError] = useState("");
  const revision = useRef(0);
  const active = isActive(run);
  const runId = run?.id;

  useEffect(() => {
    if (!runId || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const currentRevision = revision.current;
      try {
        const next = await nativeAPI().run(runId!);
        if (!cancelled && currentRevision === revision.current) {
          setRun(next);
          setPollingError("");
        }
      } catch (cause) {
        if (!cancelled && currentRevision === revision.current)
          setPollingError(errorMessage(cause, "Unable to refresh this run."));
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1000);
      }
    }
    timer = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, active]);

  async function start(
    goal: string,
    appIds: string[],
    consent: boolean,
    mode: "hybrid" | "jev",
    plannerScreenshot: boolean,
  ) {
    setBusy(true);
    setError("");
    setPollingError("");
    revision.current += 1;
    try {
      setRun(
        await nativeAPI().start({
          goal,
          appIds,
          consent,
          mode,
          plannerScreenshot,
        }),
      );
      return true;
    } catch (cause) {
      setError(errorMessage(cause, "Unable to start the task."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function action(name: "approve" | "confirm" | "stop") {
    if (!run) return;
    if (name === "approve" && !run.pendingAction) {
      setError("That action is no longer waiting for approval.");
      return;
    }
    setBusy(true);
    setError("");
    setPollingError("");
    const actionRevision = ++revision.current;
    try {
      const api = nativeAPI();
      const next = await (name === "approve"
        ? api.approve(run.id, run.pendingAction!.id)
        : name === "confirm"
          ? api.confirm(run.id)
          : api.stop(run.id));
      if (revision.current === actionRevision) {
        revision.current += 1;
        setRun(next);
        setBusy(false);
      }
    } catch (cause) {
      if (revision.current === actionRevision) {
        setError(errorMessage(cause, "Unable to update the task."));
        setBusy(false);
      }
    }
  }
  function reset() {
    if (active || busy) return;
    revision.current += 1;
    setRun(null);
    setError("");
    setPollingError("");
  }
  return {
    run,
    busy,
    error: error || pollingError,
    active,
    start,
    action,
    reset,
  };
}
