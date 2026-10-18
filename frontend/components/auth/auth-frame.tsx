"use client";

/**
 * Frame for the signed-out pages: sign in, forgot and reset password,
 * accept invite, licence error. A brand panel beside one form card on the canvas.
 */

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { MeridianMark } from "@/components/meridian/icons";

export const authFormClass = "flex flex-col gap-4";
export const authLinkClass = "m-text-body hover:underline";
export const authLinkStyle = { color: "var(--m-accent)" };

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

const FACTS = ["Your SAP data stays on this server", "Every score links to its rules and records"];

// The ScoreRing geometry (270 degree arc, open at 12 o'clock) as a brand instrument. Decorative: it carries no data.
const RING = 320;
const STROKE = 6;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const ARC = CIRC * 0.75;

function Instrument() {
  const c = RING / 2;
  const arc = { strokeDasharray: `${ARC} ${CIRC}` };
  return (
    <div className="relative" style={{ width: RING, height: RING }}>
      <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true" className="absolute inset-0">
        <circle cx={c} cy={c} r={R} fill="none" stroke="var(--m-hero-line)" strokeWidth={STROKE} strokeLinecap="round" transform={`rotate(-45 ${c} ${c})`} {...arc} />
        <circle className="m-motion-draw" cx={c} cy={c} r={R} fill="none" stroke="var(--m-accent)" strokeWidth={STROKE} strokeLinecap="round" transform={`rotate(-45 ${c} ${c})`}
          style={{ "--m-draw-length": ARC } as CSSProperties} {...arc} />
        <line x1={c} x2={c} y1={STROKE / 2} y2={RING - STROKE / 2} stroke="var(--m-hero-ink)" strokeOpacity={0.4} strokeWidth={1} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-14 text-center">
        <p className="font-semibold" style={{ fontSize: "var(--m-text-verdict)", lineHeight: "var(--m-leading-verdict)", color: "var(--m-hero-ink)" }}>SAP data quality, measured.</p>
        <p className="m-text-body" style={{ color: "var(--m-hero-ink-2)" }}>Readiness, findings and fixes in one place.</p>
      </div>
    </div>
  );
}

export function AuthFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-rows-[200px_1fr] lg:grid-cols-[clamp(440px,45%,620px)_1fr] lg:grid-rows-1" style={{ background: "var(--m-canvas)" }}>
      <aside className="m-brand-panel m-motion-stagger flex flex-col justify-between" style={{ padding: 32 }}>
        <div className="flex items-center gap-2.5">
          <MeridianMark size={32} variant="mono" style={{ color: "var(--m-hero-ink)" }} />
          <span className="font-semibold" style={{ fontSize: "var(--m-text-title)", color: "var(--m-hero-ink)" }}>Meridian</span>
        </div>
        <div className="hidden flex-col items-center gap-8 lg:flex">
          <Instrument />
          <ul className="grid grid-cols-2 gap-x-6 gap-y-3">
            {FACTS.map((f) => (
              <li key={f} className="m-text-body flex items-start gap-2" style={{ color: "var(--m-hero-ink-2)" }}>
                <span aria-hidden className="mt-1.5 shrink-0" style={{ width: 6, height: 6, background: "var(--m-accent)" }} />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="m-meridian-line hidden lg:block" aria-hidden="true" />
      </aside>
      <div className="relative flex flex-col items-center justify-center px-4 py-12">
        <div className="m-motion-stagger flex w-full max-w-[400px] flex-col gap-2">
          <div className="m-card m-motion-rise flex w-full flex-col gap-4 p-6 min-[480px]:p-8 [&_.m-btn]:h-10 [&_.m-input]:h-10">
            <h1 className="font-semibold" style={{ fontSize: "var(--m-text-title)", lineHeight: "var(--m-leading-title)", color: "var(--m-ink)" }}>{title}</h1>
            {lead ? <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{lead}</p> : null}
            {children}
          </div>
          {appVersion ? <p className="m-text-meta self-end font-mono" style={{ color: "var(--m-ink-3)" }}>v{appVersion}</p> : null}
        </div>
        <div className="absolute bottom-4 right-4"><ThemeToggle /></div>
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
        : helper ? <p id={noteId} className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{helper}</p> : null}
    </div>
  );
}
