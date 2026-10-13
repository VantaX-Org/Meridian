"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { Input } from "./Input";
import { Mono } from "./Mono";

/**
 * Confirms a consequential action. `tone: "danger"` uses the danger button and the destructive title size.
 * `typeToConfirm` makes the user type that exact value (a team name, say) before the button enables.
 * Label the buttons with the action and its inverse ("Delete team" / "Keep"), never OK / Cancel.
 */
export function ConfirmDialog({
  open, onOpenChange, title, body, confirmLabel, cancelLabel = "Keep", tone = "default", typeToConfirm, pending = false, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  typeToConfirm?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  // Clear on every close, including a controlled close after success, and whenever the value to type changes
  // (state adjusted during render, the React-documented pattern, so no effect is needed).
  const resetKey = `${open}:${typeToConfirm ?? ""}`;
  const [prevKey, setPrevKey] = useState(resetKey);
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    if (!open) setTyped("");
  }
  const matched = typeToConfirm === undefined || typed === typeToConfirm;

  const change = (next: boolean) => {
    if (pending && !next) return;
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      title={title}
      destructive={tone === "danger"}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={() => change(false)}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} pending={pending} disabled={!matched} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>{body}</div>
        {typeToConfirm !== undefined && (
          <Field label="Type to confirm">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typeToConfirm}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => { if (e.key === "Enter" && matched && !pending) onConfirm(); }}
            />
          </Field>
        )}
        {typeToConfirm !== undefined && (
          <p className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
            Matches exactly: <Mono inline>{typeToConfirm}</Mono>
          </p>
        )}
      </div>
    </Dialog>
  );
}
