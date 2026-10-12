"use client";

/**
 * Frame for the signed-out pages: sign in, forgot and reset password,
 * accept invite, licence error. One centred card on the canvas.
 */

import { useId, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { MeridianMark } from "@/components/meridian/icons";

export const authFormClass = "flex flex-col gap-4";
export const authLinkClass = "text-[13px] leading-[18px] hover:underline";
export const authLinkStyle = { color: "var(--m-accent)" };

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

export function AuthFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12" style={{ background: "var(--m-canvas)" }}>
      <div className="flex w-full max-w-[400px] flex-col gap-2">
        <div className="m-elev-1 m-motion-rise flex w-full flex-col gap-4 p-6 min-[480px]:p-8"
          style={{ background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)" }}>
          <div className="flex items-center gap-2.5">
            <MeridianMark size={28} />
            <span className="text-[15px] font-semibold leading-5" style={{ color: "var(--m-ink)" }}>Meridian</span>
          </div>
          <h1 className="text-[20px] font-semibold leading-[26px]" style={{ color: "var(--m-ink)" }}>{title}</h1>
          {lead ? <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{lead}</p> : null}
          {children}
        </div>
        {appVersion ? (
          <p className="text-right font-mono text-[11px] leading-[14px]" style={{ color: "var(--m-ink-3)" }}>v{appVersion}</p>
        ) : null}
      </div>
    </main>
  );
}

/** Password input with a visibility toggle inside the field; the helper is its own line, never part of the label. */
export function PasswordField({ label, value, onChange, autoComplete, helper, error, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password";
  helper?: string; error?: string; readOnly?: boolean;
}) {
  const [show, setShow] = useState(false);
  const inputId = useId();
  const noteId = `${inputId}-note`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="m-field-label">{label}</label>
      <div className="relative">
        <input id={inputId} className="m-input w-full" style={{ paddingRight: 44 }} type={show ? "text" : "password"} required
          autoComplete={autoComplete} readOnly={readOnly}
          aria-invalid={error ? true : undefined} aria-describedby={error || helper ? noteId : undefined}
          value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} aria-controls={inputId}
          onClick={() => setShow((v) => !v)}
          className="m-motion-colors absolute right-1 top-1 inline-flex size-6 items-center justify-center hover:[background:var(--m-sheet-raised)]"
          style={{ color: "var(--m-ink-2)", borderRadius: "var(--m-radius-control)" }}>
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {error ? <p id={noteId} className="m-field-error">{error}</p>
        : helper ? <p id={noteId} className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{helper}</p> : null}
    </div>
  );
}
