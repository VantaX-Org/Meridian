"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { useUpdateModal, UPDATE_SNOOZE_KEY } from "@/context/update-modal-context";
import {
  getUpdateStatus,
  getUpdateProgress,
  triggerUpdate,
  type UpdateProgressStatus,
} from "@/lib/api/system-update";

/**
 * `"reconnecting"` on the wire has two distinct sources that we deliberately
 * treat identically:
 *  1. The api route itself returns it (HTTP 200) when the updater sidecar
 *     is briefly unreachable but the api process is still up.
 *  2. The poll fetch throws outright (network error / non-2xx) — expected
 *     when the update process restarts the api container and the ingress
 *     in front of it, so the endpoint goes dark for ~10-60s partway through
 *     a real update.
 * Only `"reconnect_timeout"` is purely a client-side construct: reconnecting
 * (via either source, or any mix of the two) for 3+ minutes without a real
 * status back. Terminal for auto-polling; the admin can retry manually.
 */
type ProgressPhase = UpdateProgressStatus | "reconnect_timeout";

type Stage = "closed" | "announce" | "confirm" | "submitting" | "progress";

const POLL_INTERVAL_MS = 2500;
const RECONNECT_CAP_MS = 3 * 60 * 1000;

const TERMINAL_PHASES: ProgressPhase[] = ["done", "failed", "rolled_back", "reconnect_timeout"];

function progressCopy(phase: ProgressPhase, message: string): string {
  switch (phase) {
    case "idle":
    case "pulling":
      return "Downloading new version…";
    case "restarting":
      return "Restarting services… this can take up to a minute.";
    case "migrating":
      return "Applying database migrations…";
    case "verifying":
      return "Verifying the new version is healthy…";
    case "reconnecting":
      return "Still restarting — checking again…";
    case "reconnect_timeout":
      return "This is taking longer than expected — check the server or contact support.";
    case "done":
      return "Update complete — reloading…";
    case "failed":
      return message || "The update failed.";
    case "rolled_back":
      return message || "The update was rolled back.";
    default:
      return message;
  }
}

export function UpdateAvailableModal() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { openSignal } = useUpdateModal();

  const statusQ = useQuery({
    queryKey: ["system-update-status"],
    queryFn: getUpdateStatus,
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const status = statusQ.data;

  // `rawStage` only changes in response to direct user action (a click
  // handler) — never inside an effect. Auto-open (a fresh update showing
  // up) and forced-open (the Admin page's "Check for Updates") are instead
  // folded into the derived `stage`/`visible` below, computed straight from
  // render-time inputs, so there's no "setState synchronously inside an
  // effect" cascading-render pattern anywhere in this component.
  const [rawStage, setRawStage] = useState<Stage>("closed");
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [handledOpenSignal, setHandledOpenSignal] = useState(0);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ProgressPhase | null>(null);
  const [progressMessage, setProgressMessage] = useState("");

  const mountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectStartRef = useRef<number | null>(null);
  // Holds the latest `pollOnce` so the recursive setTimeout calls below can
  // go through a ref instead of `pollOnce` referencing itself directly —
  // the direct form trips this repo's react-hooks/immutability rule
  // ("accessed before it is declared"), even though it's runtime-safe here.
  const pollOnceRef = useRef<() => void>(() => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Auto-open eligibility, computed straight from render-time inputs
  // (no effect): admin, an update is available, the updater sidecar is
  // actually configured (otherwise there's no actionable button — the
  // admin gets the info via the Admin page's Platform Version section
  // instead, see admin/page.tsx), this exact latest_version hasn't been
  // snoozed via localStorage, and it hasn't been plainly dismissed (the
  // "×" / backdrop close, which doesn't persist across a full reload)
  // during this mount.
  const snoozedVersion =
    typeof window !== "undefined" ? localStorage.getItem(UPDATE_SNOOZE_KEY) : null;
  const autoEligible = Boolean(
    isAdmin &&
      status?.update_available &&
      status.updater_configured &&
      snoozedVersion !== status.latest_version &&
      dismissedVersion !== status.latest_version,
  );

  // Force-open request from elsewhere (Admin page "Check for Updates") —
  // true until `handleClose` catches `handledOpenSignal` up to it. The
  // Admin page's own button is already gated on `updater_configured`, but
  // guard it here too in case that flips false in the split second between
  // render and click — this component must never present an actionable
  // "Update Now" screen when there's no sidecar to run it.
  const forcedOpen = openSignal > handledOpenSignal && status?.updater_configured !== false;

  // The actually-displayed stage: once the admin has taken any action
  // (rawStage left "closed"), auto-eligibility / a force-open request
  // presents as "announce"; any later stage the admin has navigated to
  // (confirm/submitting/progress) always wins and stays put regardless of
  // how auto-eligibility fluctuates in the background (e.g. once the
  // triggered update completes, `update_available` may flip before the
  // page reloads — that must not yank the progress view away).
  const stage: Stage =
    rawStage === "closed" && (autoEligible || forcedOpen) ? "announce" : rawStage;

  // Marks that we're in some flavour of "still restarting, checking again"
  // — whether the api answered 200 with status:"reconnecting" itself, or
  // the fetch threw outright — and enforces the shared 3-minute cap across
  // however the two flavours interleave during one update.
  const enterReconnecting = useCallback((): "reconnect_timeout" | "reconnecting" => {
    const now = Date.now();
    if (reconnectStartRef.current == null) reconnectStartRef.current = now;
    const elapsed = now - reconnectStartRef.current;
    return elapsed >= RECONNECT_CAP_MS ? "reconnect_timeout" : "reconnecting";
  }, []);

  const pollOnce = useCallback(async (): Promise<void> => {
    try {
      const data = await getUpdateProgress();
      if (!mountedRef.current) return;
      setProgressMessage(data.message ?? "");

      if (data.status === "reconnecting") {
        // The api process itself is up and answered, but the sidecar it
        // proxies to isn't — same "still restarting" story as a thrown
        // fetch error, so it shares the same reconnect clock/cap.
        const next = enterReconnecting();
        setPhase(next);
        if (next === "reconnect_timeout") return; // stop auto-polling
        pollTimerRef.current = setTimeout(() => pollOnceRef.current(), POLL_INTERVAL_MS);
        return;
      }

      // Any other status is real signal — reset the reconnect clock.
      reconnectStartRef.current = null;
      setPhase(data.status);

      if (data.status === "done") {
        toast.success("Meridian updated successfully — reloading…");
        setTimeout(() => window.location.reload(), 1800);
        return;
      }
      if (data.status === "failed" || data.status === "rolled_back") {
        return; // terminal — stop polling
      }
      pollTimerRef.current = setTimeout(() => pollOnceRef.current(), POLL_INTERVAL_MS);
    } catch {
      // Network-level failure — likely the api container (and the ingress
      // in front of it) is mid-recreate. Treat exactly like a server-
      // reported "reconnecting" status, sharing the same clock/cap.
      if (!mountedRef.current) return;
      const next = enterReconnecting();
      setPhase(next);
      if (next === "reconnect_timeout") return; // stop auto-polling
      pollTimerRef.current = setTimeout(() => pollOnceRef.current(), POLL_INTERVAL_MS);
    }
  }, [enterReconnecting]);

  // Keep the ref pointed at the latest pollOnce (identity is effectively
  // stable since enterReconnecting never changes, but this stays correct
  // even if that ever stops being true).
  useEffect(() => {
    pollOnceRef.current = () => {
      void pollOnce();
    };
  }, [pollOnce]);

  const handleClose = () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    // Consume any pending force-open and suppress auto-reshow for this
    // exact version for the rest of this mount (a fresh navigation/reload
    // re-evaluates from scratch, so this isn't a persistent snooze).
    setHandledOpenSignal(openSignal);
    if (status?.latest_version) setDismissedVersion(status.latest_version);
    setRawStage("closed");
  };

  const handleSnooze = () => {
    if (status?.latest_version && typeof window !== "undefined") {
      localStorage.setItem(UPDATE_SNOOZE_KEY, status.latest_version);
    }
    handleClose();
  };

  const handleConfirmUpdate = async () => {
    setRawStage("submitting");
    setTriggerError(null);
    try {
      await triggerUpdate();
      // Whether this call started a fresh update or found one already
      // running, the real state of the world is whatever
      // getUpdateProgress() says next — start polling immediately.
      setRawStage("progress");
      reconnectStartRef.current = null;
      void pollOnce();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setTriggerError(detail || "Could not start the update. Please try again.");
      setRawStage("confirm");
    }
  };

  const handleManualRetry = () => {
    reconnectStartRef.current = null;
    setPhase(null);
    void pollOnce();
  };

  if (stage === "closed" || !status) return null;

  const isTerminal = phase != null && TERMINAL_PHASES.includes(phase);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.72)", backdropFilter: "blur(6px)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
      onClick={(e) => {
        // Never let a stray backdrop click drop progress tracking while an
        // update is actually running (or being submitted) — the backend
        // update keeps going either way, but the admin would silently lose
        // visibility into it. The explicit "×"/Close buttons remain
        // available for an intentional dismissal.
        if (e.target === e.currentTarget && stage !== "submitting" && stage !== "progress") {
          handleClose();
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-xl p-6 shadow-2xl"
        style={{
          background: "var(--aurora-canvas-raised, #111726)",
          border: "1px solid var(--aurora-canvas-line, #2a3654)",
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2
            id="update-modal-title"
            className="text-xl font-semibold"
            style={{ color: "var(--aurora-fg-primary, #f7f8fa)" }}
          >
            {stage === "progress"
              ? "Updating Meridian"
              : "A new version of Meridian is available"}
          </h2>
          {stage !== "submitting" && (
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-lg leading-none transition-opacity hover:opacity-70"
              style={{ color: "var(--aurora-fg-tertiary, #8a93a8)" }}
            >
              ×
            </button>
          )}
        </div>

        {stage === "announce" && (
          <>
            <p className="text-sm mb-1" style={{ color: "var(--aurora-fg-secondary, #c7d0dc)" }}>
              <strong style={{ color: "var(--aurora-fg-primary)" }}>
                {status.latest_version}
              </strong>{" "}
              is available — you&apos;re currently running{" "}
              <strong style={{ color: "var(--aurora-fg-primary)" }}>
                {status.current_version}
              </strong>
              .
            </p>
            {status.release_notes && (
              <p
                className="text-sm mb-5 mt-3 rounded-md p-3 whitespace-pre-wrap"
                style={{
                  background: "var(--aurora-canvas-elevated, #172034)",
                  border: "1px solid var(--aurora-canvas-line)",
                  color: "var(--aurora-fg-secondary)",
                  maxHeight: 180,
                  overflowY: "auto",
                }}
              >
                {status.release_notes}
              </p>
            )}
            <div className="flex items-center justify-between pt-3">
              <button
                type="button"
                onClick={handleSnooze}
                className="text-sm underline"
                style={{ color: "var(--aurora-fg-tertiary)" }}
              >
                Remind me later
              </button>
              <button
                type="button"
                onClick={() => setRawStage("confirm")}
                className="rounded-md px-5 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                style={{ background: "var(--aurora-accent-500, #0057d2)", color: "#ffffff" }}
              >
                Update now
              </button>
            </div>
          </>
        )}

        {(stage === "confirm" || stage === "submitting") && (
          <>
            <div
              className="text-sm mb-5 mt-2 rounded-md p-3"
              style={{
                background: "var(--aurora-status-warning-bg)",
                border: "1px solid var(--aurora-status-warning-border)",
                color: "var(--aurora-fg-primary)",
              }}
            >
              This restarts the entire Meridian stack for everyone currently
              signed in. The update usually takes a few minutes. Make sure
              nothing else is mid-run (an import, a sync, a report export)
              before continuing.
            </div>
            {triggerError && (
              <p className="text-sm mb-3" style={{ color: "var(--aurora-status-danger-500)" }}>
                {triggerError}
              </p>
            )}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setRawStage("announce")}
                disabled={stage === "submitting"}
                className="text-sm underline disabled:opacity-50"
                style={{ color: "var(--aurora-fg-tertiary)" }}
              >
                Don&apos;t update yet
              </button>
              <button
                type="button"
                onClick={handleConfirmUpdate}
                disabled={stage === "submitting"}
                className="rounded-md px-5 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--aurora-status-danger-500)", color: "#ffffff" }}
              >
                {stage === "submitting" ? "Starting…" : "Yes, update now"}
              </button>
            </div>
          </>
        )}

        {stage === "progress" && (
          <>
            <div className="flex items-center gap-3 mb-4 mt-2">
              {!isTerminal && (
                <div
                  className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: "var(--aurora-accent-500)", borderTopColor: "transparent" }}
                  aria-hidden
                />
              )}
              <p
                className="text-sm"
                style={{
                  color:
                    phase === "failed"
                      ? "var(--aurora-status-danger-500)"
                      : phase === "rolled_back"
                        ? "var(--aurora-status-warning-500)"
                        : "var(--aurora-fg-secondary)",
                }}
              >
                {phase ? progressCopy(phase, progressMessage) : "Starting the update…"}
              </p>
            </div>

            {phase === "rolled_back" && (
              <div
                className="text-sm mb-4 rounded-md p-3"
                style={{
                  background: "var(--aurora-status-warning-bg)",
                  border: "1px solid var(--aurora-status-warning-border)",
                  color: "var(--aurora-fg-primary)",
                }}
              >
                Update failed and was automatically rolled back — no action
                needed. Meridian is back on {status.current_version}.
                {progressMessage ? ` (${progressMessage})` : ""}
              </div>
            )}

            {phase === "failed" && (
              <div
                className="text-sm mb-4 rounded-md p-3"
                style={{
                  background: "var(--aurora-status-danger-bg)",
                  border: "1px solid var(--aurora-status-danger-border)",
                  color: "var(--aurora-fg-primary)",
                }}
              >
                {progressMessage || "The update failed. Check the server logs or contact support."}
              </div>
            )}

            {phase === "reconnect_timeout" && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleManualRetry}
                  className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                  style={{ background: "var(--aurora-accent-500)", color: "#ffffff" }}
                >
                  Check again
                </button>
              </div>
            )}

            {(phase === "failed" || phase === "rolled_back") && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                  style={{ background: "var(--aurora-canvas-elevated)", color: "var(--aurora-fg-primary)" }}
                >
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
