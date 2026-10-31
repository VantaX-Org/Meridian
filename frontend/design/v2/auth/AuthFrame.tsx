"use client";

import { forwardRef, useId, useRef, useState, type ReactNode } from "react";
import { useWindowTitle } from "../parts";
import "../system.css";
import "./auth.css";
import { Mark } from "../marks";
import { t } from "@/lib/v2/i18n";
import { productName, useTenantTheme } from "@/lib/v2/theme";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

/**
 * The frame of every signed-out page and of the forced password change. On a wide screen two columns on the slate
 * ground: on the left the tenant's mark and name, the one sentence of what the product does, three facts in plain
 * words and the ruler drawn as the brand's own picture; on the right one white card with the page's h1, an optional
 * lead and the form, the version under it. On a phone the mark and name, then the card, then the facts.
 */
export function AuthFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const theme = useTenantTheme();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useWindowTitle(titleRef);
  return (
    <main className="m2-auth" id="main">
      <div className="m2-auth-wrap">
        <span className="m2-auth-brand" data-testid={theme?.customised ? "tenant-brand" : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's logo, served by the API */}
          {theme?.logo_url ? <img src={theme.logo_url} alt="" className="m2-auth-tenant" /> : <Mark size={28} />}
          <span>{productName(theme)}</span>
        </span>
        <section className="m2-auth-about" aria-label={t("About {product}", { product: productName(theme) })}>
          <p className="m2-auth-promise">{t("SAP data quality, scored and routed to the people who fix it.")}</p>
          <ul className="m2-auth-facts-list">
            <li>{t("Every figure is a rule result over your own records, and each one explains its arithmetic.")}</li>
            <li>{t("Each object is scored on one ruler: six dimensions, a cap when a critical rule fails.")}</li>
            <li>{t("Your SAP data, findings and reports stay in your environment.")}</li>
          </ul>
          <RulerMotif />
        </section>
        <div className="m2-auth-col">
          <div className="m2-auth-card">
            <h1 ref={titleRef}>{title}</h1>
            {lead ? <p className="m2-auth-lead">{lead}</p> : null}
            {children}
          </div>
          {appVersion ? <p className="m2-auth-meta m2-auth-version">{`v${appVersion}`}</p> : null}
        </div>
      </div>
    </main>
  );
}

/** The DQS weights of the six dimensions, completeness first: the widths of the ruler's segments. */
const MOTIF_WEIGHTS = [25, 25, 20, 10, 10, 10] as const;
const MOTIF_FILL = [0.92, 0.84, 0.88, 0.7, 0.96, 0.78] as const;

/**
 * The ruler as a picture: six segments as wide as their weights, each filled to a score, the tick across them at the
 * measured score. Decorative; the words beside it say what it is.
 */
function RulerMotif() {
  const W = 320;
  const H = 72;
  const gap = 4;
  const room = W - gap * (MOTIF_WEIGHTS.length - 1);
  const segs = MOTIF_WEIGHTS.map((w, i) => ({
    x: MOTIF_WEIGHTS.slice(0, i).reduce((a, b) => a + (room * b) / 100 + gap, 0),
    width: (room * w) / 100,
    fill: MOTIF_FILL[i],
  }));
  const tickY = H * (1 - 0.86);
  return (
    <svg className="m2-auth-motif" viewBox={`0 0 ${W} ${H + 8}`} width={W} height={H + 8} aria-hidden="true" focusable="false">
      {segs.map((sg, i) => (
        <g key={i}>
          <rect className="m2-auth-motif-t" x={sg.x} y={0} width={sg.width} height={H} rx={2} />
          <rect className="m2-auth-motif-f" x={sg.x} y={H * (1 - sg.fill)} width={sg.width} height={H * sg.fill} rx={2} />
        </g>
      ))}
      <rect className="m2-auth-motif-k" x={-4} y={tickY - 1} width={W + 8} height={2} rx={1} />
    </svg>
  );
}

/** A note in the card: an error, a warning or information, with an optional title in the ink colour. */
export const AuthNote = forwardRef<HTMLDivElement, { tone: "danger" | "warning" | "info"; title?: string; children?: ReactNode; focusable?: boolean }>(function AuthNote({ tone, title, children, focusable }, ref) {
  return (
    <div ref={ref} className="m2-auth-note" data-tone={tone} role={tone === "info" ? "status" : "alert"} tabIndex={focusable ? -1 : undefined}>
      {title ? <strong>{title}</strong> : null}
      {children ? <span>{children}</span> : null}
    </div>
  );
});

/** A text field of a signed-out form: the label above, the error or hint under it, never inside the label. */
export function AuthField({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className="m2-fld">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? noteId : undefined })}
      {error ? (
        <span id={noteId} className="m2-ferr" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={noteId} className="m2-fhint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** A password with a Show and Hide button inside the field. */
export function PasswordField({ label, value, onChange, autoComplete, hint, error, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password";
  hint?: string; error?: string; readOnly?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <AuthField label={label} error={error} hint={hint}>
      {(p) => (
        <div className="m2-auth-pw">
          <input {...p} type={show ? "text" : "password"} required autoComplete={autoComplete} readOnly={readOnly} value={value} onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="m2-auth-show" aria-pressed={show} aria-controls={p.id} aria-label={show ? t("Hide password") : t("Show password")} onClick={() => setShow((v) => !v)}>
            {show ? t("Hide") : t("Show")}
          </button>
        </div>
      )}
    </AuthField>
  );
}
