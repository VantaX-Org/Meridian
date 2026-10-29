"use client";

import { useId, type ReactNode } from "react";
import "./system.css";

export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/** A labelled form control with an optional hint and error. The control comes from `children`, which gets the ids to wire. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: ControlProps) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-h` : null, error ? `${id}-e` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="m2-fld">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <span id={`${id}-h`} className="m2-fhint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-e`} className="m2-ferr" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** The inline answer to a destructive verb: says what goes, offers the verb and its way back. No modal, no toast. */
export function ConfirmBar({ message, confirmLabel, keepLabel = "Keep", pending, disabled, onConfirm, onCancel }: { message: ReactNode; confirmLabel: string; keepLabel?: string; pending?: boolean; disabled?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="m2-confirm" role="group" aria-label="Confirm" data-testid="confirm-bar">
      <p>{message}</p>
      <div className="m2-acts">
        <button type="button" className="m2-btn m2-danger" disabled={pending || disabled} onClick={onConfirm}>
          {pending ? "Working…" : confirmLabel}
        </button>
        <button type="button" className="m2-btn m2-ghost" onClick={onCancel}>
          {keepLabel}
        </button>
      </div>
    </div>
  );
}

/** A sentence that says why a control is off, or what role the verb needs. Quiet, in the flow. */
export function Gate({ children }: { children: ReactNode }) {
  return (
    <p className="m2-prov" data-testid="gate-note">
      {children}
    </p>
  );
}
