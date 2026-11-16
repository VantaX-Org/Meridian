"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { V2Link } from "@/design/v2/parts";
import { Chip, type ChipTone } from "../../kit";
import "./objects.css";

/** What an action answered, kept in the inspector it was started from. */
export interface Outcome {
  tone: "ok" | "fail" | "info";
  title: string;
  detail?: string;
  /** A job the action started: the line links to its inspector. */
  job?: string | null;
}

/** One action at a time: `run(key, fn)` marks the key pending, then keeps what `fn` returned, or the API's own sentence. */
export function useOutcome(): { outcome: Outcome | null; pending: string | null; run: (key: string, fn: () => Promise<Outcome>) => Promise<void>; clear: () => void } {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (key: string, fn: () => Promise<Outcome>) => {
    setPending(key);
    setOutcome(null);
    try {
      const next = await fn();
      if (alive.current) setOutcome(next);
    } catch (e) {
      if (alive.current) setOutcome({ tone: "fail", title: t("It did not go through"), detail: failureText(e) });
    } finally {
      if (alive.current) setPending(null);
    }
  }, []);
  const clear = useCallback(() => setOutcome(null), []);
  return { outcome, pending, run, clear };
}

/** An action's answer in place of a toast: a chip with the word, what the system said, and the job it started. */
export function OutcomeLine({ outcome }: { outcome: Outcome }) {
  const { hrefFor } = useOpenItem();
  return (
    <div className="nx-ob-result" role="status" data-tone={outcome.tone} data-testid="action-result">
      <Chip tone={outcome.tone === "ok" ? "good" : outcome.tone === "fail" ? "bad" : "neutral"}>{outcome.title}</Chip>
      {outcome.detail ? <span>{outcome.detail}</span> : null}
      {outcome.job ? <V2Link href={hrefFor({ kind: "job", id: outcome.job })}>{t("Open the job")}</V2Link> : null}
    </div>
  );
}

/** A missing value: a dash, with why in the tooltip. */
export function Dash({ why }: { why?: string }) {
  return (
    <span className="nx-ob-dash" title={why}>
      {"—"}
    </span>
  );
}

/** A titled section of the inspector body. */
export function Sec({ title, children, testId, label }: { title: ReactNode; children: ReactNode; testId?: string; label?: string }) {
  return (
    <section className="nx-ib-sec" data-testid={testId} aria-label={label}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** A sentence beside an action, in the quiet face. */
export function Note({ children, id, testId }: { children: ReactNode; id?: string; testId?: string }) {
  return (
    <p className="nx-ib-meta nx-ob-note" id={id} data-testid={testId}>
      {children}
    </p>
  );
}

/** Why an action is off: the permission it needs, in words. */
export function Gate({ children }: { children: ReactNode }) {
  return (
    <p className="nx-ib-meta nx-ob-note" data-testid="gate-note">
      {children}
    </p>
  );
}

export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/** A labelled control with its hint and its error; the control comes from the render prop so it gets the ids. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: ControlProps) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-h` : null, error ? `${id}-e` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="nx-ob-fld">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <span id={`${id}-h`} className="nx-ob-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-e`} className="nx-ob-ferr" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const ABAP = new Set(["ecc", "s4hana_onprem", "ewm"]);

/** The wire a system speaks, as the word the page uses: RFC for the ABAP systems, REST or OData for the cloud ones. */
export function protocolOf(type: string): "RFC" | "OData" | "REST" {
  return ABAP.has(type) ? "RFC" : type === "concur" || type === "ariba" ? "REST" : "OData";
}

const HEALTH_WORD = (h: string): string | undefined =>
  ({ healthy: t("Connected"), degraded: t("Degraded"), unreachable: t("Unreachable"), auth_failed: t("Sign-in refused"), unknown: t("Not tested yet") })[h];

const healthTone = (h: string | null | undefined): ChipTone => (h === "healthy" ? "good" : h === "degraded" || h === "unknown" || !h ? "warn" : "bad");

/** Health as a chip with a word, never colour alone. */
export function HealthWord({ health }: { health: string | null | undefined }) {
  return <Chip tone={healthTone(health)}>{HEALTH_WORD(health ?? "unknown") ?? labelText(health)}</Chip>;
}
