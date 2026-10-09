"use client";

/**
 * Frame for the signed-out pages: sign in, forgot and reset password,
 * accept invite, licence error. Form on the left, plain facts on the right.
 */

import { useState, type ReactNode } from "react";
import { MeridianMark } from "@/components/meridian/icons";
import { Button, Field } from "@/design";
import { useAuroraPrefs } from "@/hooks/use-theme";

/** Markup shared by the signed-out forms, so each page keeps the same spacing. */
export const authFormClass = "flex flex-col gap-3";
export const authActionsClass = "flex items-center gap-2 pt-1";
export const authInputClass = "w-full rounded border px-3 py-1.5 text-[13px]";
export const authInputStyle = { borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" };
export const authLinkClass = "text-[13px]";
export const authLinkStyle = { color: "var(--m-accent)" };

/** Bordered note, tinted by outcome. Replaces the legacy Banner on the signed-out pages. */
export function AuthNotice({ tone, title, children }: { tone: "danger" | "success"; title?: string; children: ReactNode }) {
  const colour = tone === "danger" ? "var(--m-critical)" : "var(--m-pass)";
  return (
    <div className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: colour, color: "var(--m-ink)" }} role={tone === "danger" ? "alert" : "status"}>
      {title ? <p className="font-medium" style={{ color: colour }}>{title}</p> : null}
      <div className={title ? "mt-1" : undefined} style={{ color: "var(--m-ink-2)" }}>{children}</div>
    </div>
  );
}

export function AuthFrame({ title, lead, side, children }: { title: string; lead?: ReactNode; side?: ReactNode; children: ReactNode }) {
  useAuroraPrefs(); // signed-out pages follow the theme picked in the app
  return (
    <div className="flex min-h-screen" style={{ background: "var(--m-canvas)" }}>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-[380px] flex-col gap-4">
          <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>
            <MeridianMark size={20} aria-hidden /> Meridian
          </div>
          <h1 className="text-[22px] leading-[28px] font-semibold" style={{ color: "var(--m-ink)" }}>{title}</h1>
          {lead ? <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>{lead}</p> : null}
          {children}
        </div>
      </main>
      {side ? (
        <aside className="hidden w-[360px] flex-col justify-center gap-3 border-l px-8 lg:flex"
          style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
          {side}
        </aside>
      ) : null}
    </div>
  );
}

/** Password input with a Show/Hide toggle. */
export function PasswordField({ label, value, onChange, autoComplete, helper }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password"; helper?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={helper ? `${label} — ${helper}` : label}>
      <div className="flex items-center gap-2">
        <input className={authInputClass} style={authInputStyle} type={show ? "text" : "password"} required autoComplete={autoComplete}
          aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
        <Button type="button" variant="ghost" aria-pressed={show} onClick={() => setShow((v) => !v)}>
          {show ? "Hide" : "Show"}
        </Button>
      </div>
    </Field>
  );
}
