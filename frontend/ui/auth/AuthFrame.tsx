"use client";

import { forwardRef, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { t } from "@/lib/v2/i18n";
import { productName, useTenantTheme } from "@/lib/v2/theme";
import "./auth.css";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

/** The mark: a diamond with a meridian line. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="1.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />
      <path d="M12 2.5C7.6 7.6 7.6 16.4 12 21.5" />
    </svg>
  );
}

/** Holds document.title at "<h1 text> – Meridian" for a page whose h1 is the first on the page. */
export function useWindowTitle(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const h = ref.current;
    if (!h || document.querySelector("h1") !== h) return;
    const words = (h.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!words) return;
    // i18n-ignore: the product name, after the translated h1
    const want = `${words} – Meridian`;
    const hold = () => {
      if (document.title !== want) document.title = want;
    };
    hold();
    if (typeof MutationObserver === "undefined") return;
    const watch = new MutationObserver(hold);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  });
}

/**
 * The frame of every signed-out page and of the forced password change: the tenant's mark and name, then one centred
 * solid card, 28rem wide, with the page's h1, an optional lead and the form, the version under it. No glass.
 */
export function AuthFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const theme = useTenantTheme();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useWindowTitle(titleRef);
  return (
    <main className="mx-auth" id="main">
      <div className="mx-auth-wrap">
        <span className="mx-auth-brand" data-testid={theme?.customised ? "tenant-brand" : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's logo, served by the API */}
          {theme?.logo_url ? <img src={theme.logo_url} alt="" className="mx-auth-tenant" /> : <Mark size={28} />}
          <span>{productName(theme)}</span>
        </span>
        <div className="mx-auth-col">
          <div className="mx-auth-card">
            <h1 ref={titleRef}>{title}</h1>
            {lead ? <p className="mx-auth-lead">{lead}</p> : null}
            {children}
          </div>
          {appVersion ? <p className="mx-auth-meta mx-auth-version">{`v${appVersion}`}</p> : null}
        </div>
      </div>
    </main>
  );
}

/** A note in the card: an error, a warning or information, with an optional title in the ink colour. */
export const AuthNote = forwardRef<HTMLDivElement, { tone: "danger" | "warning" | "info"; title?: string; children?: ReactNode; focusable?: boolean }>(function AuthNote({ tone, title, children, focusable }, ref) {
  return (
    <div ref={ref} className="mx-auth-note" data-tone={tone} role={tone === "info" ? "status" : "alert"} tabIndex={focusable ? -1 : undefined}>
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
    <div className="mx-field">
      <label className="mx-field-l" htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? noteId : undefined })}
      {error ? (
        <span id={noteId} className="mx-field-e" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={noteId} className="mx-muted">
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
        <div className="mx-auth-pw">
          <input {...p} className="mx-input" type={show ? "text" : "password"} required autoComplete={autoComplete} readOnly={readOnly} value={value} onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="mx-auth-show" aria-pressed={show} aria-controls={p.id} aria-label={show ? t("Hide password") : t("Show password")} onClick={() => setShow((v) => !v)}>
            {show ? t("Hide") : t("Show")}
          </button>
        </div>
      )}
    </AuthField>
  );
}
