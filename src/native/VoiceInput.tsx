import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { errorMessage, nativeAPI } from "../api";

type VoiceState =
  | "idle"
  | "starting"
  | "listening"
  | "finishing"
  | "cancelling"
  | "cancel_error";

export function VoiceInput({
  disabled,
  onTranscript,
  onActivityChange,
  onError,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
  onActivityChange: (active: boolean) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const generation = useRef(0);
  const phase = useRef<VoiceState>("idle");
  const stopCurrent = useRef<(() => Promise<void>) | null>(null);
  const finishedDuringStart = useRef(false);
  function transition(next: VoiceState) {
    phase.current = next;
    setState(next);
  }
  const activeRef = useRef(false);
  const active = state !== "idle";
  useEffect(() => {
    onActivityChange(active);
  }, [active, onActivityChange]);
  useEffect(() => {
    if (state !== "listening") return;
    const timer = setTimeout(() => void stop(), 40_000);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    return nativeAPI().onVoiceEnded?.((event) => {
      if (!activeRef.current) return;
      if (event.cancelled) {
        generation.current++;
        finishedDuringStart.current = false;
        end();
      } else if (phase.current === "starting") {
        finishedDuringStart.current = true;
      } else if (phase.current === "listening") {
        void stopCurrent.current?.();
      }
    });
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      if (activeRef.current)
        void nativeAPI()
          .voiceCancel()
          .catch(() => {});
    },
    [],
  );

  function end() {
    activeRef.current = false;
    transition("idle");
  }
  async function start() {
    if (disabled || activeRef.current) return;
    const revision = ++generation.current;
    activeRef.current = true;
    finishedDuringStart.current = false;
    transition("starting");
    onError("");
    try {
      const response = await nativeAPI().voiceStart();
      if (revision !== generation.current) return;
      if (response.status === "unavailable") {
        onError(
          response.message ||
            "Dictation is unavailable. Check microphone and speech permissions in system settings, or type your task.",
        );
        end();
      } else {
        transition("listening");
        if (finishedDuringStart.current) void stopCurrent.current?.();
      }
    } catch (cause) {
      if (revision !== generation.current) return;
      onError(
        errorMessage(
          cause,
          "Dictation could not start. Check system microphone permissions, or type your task.",
        ),
      );
      end();
    }
  }
  async function stop() {
    if (phase.current !== "listening" && phase.current !== "cancel_error")
      return;
    const revision = ++generation.current;
    transition("finishing");
    try {
      const response = await nativeAPI().voiceStop();
      if (revision !== generation.current) return;
      if (response.text.trim()) onTranscript(response.text);
      else
        onError(
          "No speech was recognized. Try dictating again, or type your task.",
        );
      end();
    } catch (cause) {
      if (revision !== generation.current) return;
      onError(
        errorMessage(
          cause,
          "Dictation could not finish. Your typed task is still here.",
        ),
      );
      try {
        await nativeAPI().voiceCancel();
        if (revision === generation.current) end();
      } catch {
        if (revision === generation.current) {
          transition("cancel_error");
          onError(
            "The microphone could not be stopped. Retry Cancel dictation before continuing.",
          );
        }
      }
    }
  }
  async function cancel() {
    if (!activeRef.current || phase.current === "cancelling") return;
    const revision = ++generation.current;
    transition("cancelling");
    try {
      await nativeAPI().voiceCancel();
      if (revision === generation.current) end();
    } catch (cause) {
      if (revision === generation.current) {
        transition("cancel_error");
        onError(
          errorMessage(
            cause,
            "Dictation could not be cancelled. Retry Cancel dictation before continuing.",
          ),
        );
      }
    }
  }

  stopCurrent.current = stop;

  return (
    <div className={`voice-control ${active ? "is-recording" : ""}`}>
      <span className={active ? "voice-status" : "sr-only"} role="status">
        {state === "starting"
          ? "Starting mic…"
          : state === "listening"
            ? "Listening…"
            : state === "finishing"
              ? "Transcribing…"
              : state === "cancelling"
                ? "Cancelling…"
                : state === "cancel_error"
                  ? "Check microphone"
                  : ""}
      </span>
      {active ? (
        <>
          {state === "listening" || state === "cancel_error" ? (
            <button
              type="button"
              className="icon-button voice-stop"
              aria-label="Stop dictation and add text"
              title="Stop dictation and add text"
              onClick={() => void stop()}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <LoaderCircle className="spinner" size={14} aria-hidden="true" />
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel dictation"
            title="Cancel dictation"
            disabled={state === "cancelling"}
            onClick={() => void cancel()}
          >
            <X size={15} />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="icon-button"
          disabled={disabled}
          onClick={() => void start()}
          aria-label="Dictate task"
          title="Dictate task — click to start, then stop to add text"
        >
          <Mic size={16} />
        </button>
      )}
    </div>
  );
}
