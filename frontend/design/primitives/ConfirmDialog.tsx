"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { Input } from "./Input";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  /** "danger" uses the danger button and the destructive title size. */
  tone?: "danger" | "default";
  /** The user must type this exact value before the confirm button enables, e.g. a team name. */
  typeToConfirm?: string;
  pending?: boolean;
  /** Label of the dismiss button; defaults to "Keep". */
  cancelLabel?: string;
}

/** Confirmation built on `Dialog`. Never closes itself on confirm: the caller closes it when the mutation settles. */
export function ConfirmDialog({
  open, onOpenChange, title, body, confirmLabel, onConfirm, tone = "default", typeToConfirm, pending = false, cancelLabel = "Keep",
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  // Clear the typed value whenever the dialog closes (adjusting state during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setTyped("");
  }
  const blocked = typeToConfirm !== undefined && typed !== typeToConfirm;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!pending) onOpenChange(next); }}
      title={title}
      destructive={tone === "danger"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} pending={pending} disabled={blocked}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>{body}</div>
        {typeToConfirm !== undefined && (
          <Field label={`Type ${typeToConfirm} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
