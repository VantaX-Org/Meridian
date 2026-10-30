"use client";

import { forwardRef, useId, useState, type ReactNode } from "react";
import "../system.css";
import "./auth.css";
import { Mark } from "../marks";
import { t } from "@/lib/v2/i18n";
import { productName, useTenantTheme } from "@/lib/v2/theme";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

/**
 * The frame of every signed-out page and of the forced password change: the tenant's mark and name, one card with the
 * page's h1, an optional lead and the form, and the version under it.
 */
export function AuthFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const theme = useTenantTheme();
  return (
    <main className="m2-auth" id="main">
      <div className="m2-auth-col">
        <span className="m2-auth-brand" data-testid={theme?.customised ? "tenant-brand" : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's logo, served by the API */}
          {theme?.logo_url ? <img src={theme.logo_url} alt="" className="m2-auth-tenant" /> : <Mark size={28} />}
          <span>{productName(theme)}</span>
        </span>
        <div className="m2-auth-card">
          <h1>{title}</h1>
          {lead ? <p className="m2-auth-lead">{lead}</p> : null}
          {children}
        </div>
        {appVersion ? <p className="m2-auth-meta m2-auth-version">{`v${appVersion}`}</p> : null}
      </div>
    </main>
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
