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
 * words under the heat matrix drawn as the brand's own picture; on the right one white sheet with the page's h1, an
 * optional lead and the form centred on it, the version at its foot. On a phone the mark and name, then the sheet,
 * then the facts.
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
          <HeatMotif />
          <ul className="m2-auth-facts-list">
            <li>{t("Every figure is a rule result over your own records, and each one explains its arithmetic.")}</li>
            <li>{t("Each object is scored on one ruler: six dimensions, a cap when a critical rule fails.")}</li>
            <li>{t("Your SAP data, findings and reports stay in your environment.")}</li>
          </ul>
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

/** The heat matrix as a picture: columns and rows of tiles, the band of each tile a fixed pattern (0 pass, 1 quiet, 2 warn, 3 critical). */
const HEAT_COLS = 14;
const HEAT_ROWS = 6;
const HEAT_TILE = 48;
const HEAT_GAP = 4;
/** The one chosen tile: light radiates from it. */
const HEAT_LIT = { c: 9, r: 2 } as const;
const HEAT_BANDS: readonly string[] = [
  "11011121100111",
  "01112111101010",
  "11121111231101",
  "11011211111011",
  "01111120111101",
  "11101111011110",
];

/**
 * The readiness matrix as the brand's own picture: a field of tiles in the heat bands, lit from the one chosen cell
 * and fading into the ground away from it, the chosen cell ringed. Decorative, no figures; the words above and under
 * it say what the product does.
 */
function HeatMotif() {
  const W = HEAT_COLS * HEAT_TILE + (HEAT_COLS - 1) * HEAT_GAP;
  const H = HEAT_ROWS * HEAT_TILE + (HEAT_ROWS - 1) * HEAT_GAP;
  const tiles: { c: number; r: number; band: string; light: number }[] = [];
  for (let r = 0; r < HEAT_ROWS; r++) {
    for (let c = 0; c < HEAT_COLS; c++) {
      const d = Math.hypot(c - HEAT_LIT.c, (r - HEAT_LIT.r) * 1.4);
      tiles.push({ c, r, band: HEAT_BANDS[r][c], light: Math.max(0.16, 1 - d / 8.5) });
    }
  }
  const at = (i: number) => i * (HEAT_TILE + HEAT_GAP);
  return (
    <svg className="m2-auth-heat" viewBox={`${-HEAT_GAP} ${-HEAT_GAP} ${W + HEAT_GAP * 2} ${H + HEAT_GAP * 2}`} aria-hidden="true" focusable="false">
      {tiles.map((tl) => (
        <rect key={`${tl.c}-${tl.r}`} className="m2-auth-heat-t" data-band={tl.band} x={at(tl.c)} y={at(tl.r)} width={HEAT_TILE} height={HEAT_TILE} rx={3} style={{ opacity: tl.light }} />
      ))}
      <rect className="m2-auth-heat-lit" x={at(HEAT_LIT.c) - 3} y={at(HEAT_LIT.r) - 3} width={HEAT_TILE + 6} height={HEAT_TILE + 6} rx={5} />
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
