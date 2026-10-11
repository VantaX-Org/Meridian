"use client";

/**
 * Frame for the signed-out pages: sign in, forgot and reset password,
 * accept invite, licence error. Brand panel left from lg (a 160px band below),
 * form card right. Spec section 6.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { MeridianMark } from "@/components/meridian/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/design";
import { useAuroraPrefs } from "@/hooks/use-theme";

/** Markup shared by the signed-out forms, so each page keeps the same spacing. */
export const authFormClass = "flex flex-col gap-3";
export const authActionsClass = "flex items-center gap-2 pt-1";
export const authInputClass = "m-auth-input";
export const authInputStyle = {};
export const authLinkClass = "text-[13px] hover:underline";
export const authLinkStyle = { color: "var(--m-accent)" };

/** Tinted note with a 3px tone bar. Replaces the legacy Banner on the signed-out pages. */
export function AuthNotice({ tone, title, children }: { tone: "danger" | "success"; title?: string; children?: ReactNode }) {
  const danger = tone === "danger";
  return (
    <div
      className="px-3 py-2 text-[13px] leading-[18px]"
      style={{
        background: danger ? "var(--m-critical-soft)" : "var(--m-pass-soft)",
        borderLeft: `3px solid ${danger ? "var(--m-critical)" : "var(--m-pass)"}`,
        color: danger ? "var(--m-critical-ink)" : "var(--m-pass-ink)",
        borderRadius: "var(--m-radius-control)",
      }}
      role={danger ? "alert" : "status"}
      aria-live="polite"
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}

/** 16px ring that turns while a submit is pending. */
export function AuthSpinner() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden className="m-spin">
      <circle cx={8} cy={8} r={6} stroke="currentColor" strokeOpacity={0.3} strokeWidth={2} />
      <circle cx={8} cy={8} r={6} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="9 29" />
    </svg>
  );
}

const noopSubscribe = () => () => {};
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

const FACTS = ["Runs inside your network", "800+ SAP checks", "29 modules, 7 system types", "Nothing leaves this server"];

const RING = 320;
const RING_R = 157;
const RING_C = 2 * Math.PI * RING_R;

/** Decorative instrument: the ScoreRing geometry at 320px, drawn to `pct` on mount. */
function BrandInstrument({ pct }: { pct: number }) {
  const len = (RING_C * pct) / 100;
  const mid = RING / 2;
  return (
    <div className="relative" style={{ width: RING, height: RING }} aria-hidden>
      <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} fill="none">
        <circle cx={mid} cy={mid} r={RING_R} stroke="var(--m-brand-track)" strokeWidth={6} />
        {pct > 0 ? (
          <circle cx={mid} cy={mid} r={RING_R} stroke="var(--m-brand-accent)" strokeWidth={6} strokeLinecap="round"
            strokeDasharray={`${len} ${RING_C}`} transform={`rotate(-90 ${mid} ${mid})`}
            className="m-motion-draw" style={{ ["--m-draw-length" as string]: len }} />
        ) : null}
        <g className="m-motion-rise" stroke="var(--m-brand-ink)" strokeWidth={1.5} strokeLinecap="round">
          <path d={`M${mid} 4V316`} strokeOpacity={0.4} />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-14 text-center">
        <p className="m-display text-[28px] leading-[34px]" style={{ color: "var(--m-brand-ink)" }}>SAP data quality, measured.</p>
        <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-brand-ink-2)" }}>
          Every check is deterministic. Every number opens the rows behind it.
        </p>
      </div>
    </div>
  );
}

export function AuthFrame({ title, lead, side, children, ringPct = 72 }: {
  title: string; lead?: ReactNode; side?: ReactNode; children: ReactNode;
  /** Share of the brand-panel ring that is drawn. */
  ringPct?: number;
}) {
  useAuroraPrefs(); // signed-out pages follow the theme picked in the app
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false); // false on the server and first paint
  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ background: "var(--m-canvas)" }}>
      <aside className="m-brand-panel flex h-[160px] shrink-0 flex-col justify-between p-6 lg:h-auto lg:w-[45%] lg:min-w-[440px] lg:max-w-[620px] lg:p-12">
        <div className="relative">
          <Image src="/brand/lockup-dark.svg" width={172} height={32} alt="Meridian" priority unoptimized />
        </div>
        <div className="relative hidden flex-1 items-center justify-center lg:flex">
          <BrandInstrument pct={ringPct} />
        </div>
        <div className="relative flex flex-col gap-6">
          <ul className="hidden grid-cols-2 gap-x-6 gap-y-3 lg:grid">
            {FACTS.map((f) => (
              <li key={f} className="flex items-center gap-2 text-[12px] leading-4" style={{ color: "var(--m-brand-ink-2)" }}>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--m-brand-accent)" }} />
                {f}
              </li>
            ))}
          </ul>
          <div className="m-meridian-line w-full" />
        </div>
      </aside>
      <main className="relative flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12 max-[720px]:px-3">
        <div className="absolute right-6 top-6"><ThemeToggle /></div>
        <div className="m-elev-1 m-motion-rise flex w-full max-w-[400px] flex-col gap-4 p-8"
          style={{ background: "var(--m-sheet)", borderRadius: "var(--m-radius-tile)" }}>
          <MeridianMark size={24} className="lg:hidden" />
          <h1 className="m-display text-[28px] leading-[34px]" style={{ color: "var(--m-ink)" }}>{title}</h1>
          {lead ? <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{lead}</p> : null}
          {ready ? children : (
            <div className="m-motion-stagger flex flex-col gap-3" aria-busy>
              <Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} />
            </div>
          )}
          <p className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
            Meridian runs inside your network. No data leaves this server.
            {appVersion ? <> <span className="font-mono">v{appVersion}</span></> : null}
          </p>
        </div>
        {side ? (
          <div className="flex w-full max-w-[400px] flex-col gap-2 text-[12px] leading-4" style={{ color: "var(--m-ink-2)" }}>{side}</div>
        ) : null}
      </main>
    </div>
  );
}

/** Password input with an eye toggle inside the field. */
export function PasswordField({ label, value, onChange, autoComplete, helper, error, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password";
  helper?: string; error?: string; readOnly?: boolean;
}) {
  const [show, setShow] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-[12px] leading-4" style={{ color: "var(--m-ink-2)" }}>
        {helper ? `${label} \u2014 ${helper}` : label}
      </label>
      <div className="relative">
        <input id={inputId} className={authInputClass} style={{ paddingRight: 44 }} type={show ? "text" : "password"} required
          autoComplete={autoComplete} readOnly={readOnly}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} aria-controls={inputId}
          onClick={() => setShow((v) => !v)}
          className="m-motion-colors absolute right-1 top-1 inline-flex size-8 items-center justify-center hover:[background:var(--m-sheet-raised)]"
          style={{ color: "var(--m-ink-2)", borderRadius: "var(--m-radius-control)" }}>
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {error ? <p id={errorId} className="text-[12px] leading-4" style={{ color: "var(--m-critical)" }}>{error}</p> : null}
    </div>
  );
}
