"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { t } from "@/lib/v2/i18n";
import { Button, ErrorState } from "../kit";
import "./auth.css";

/** How long the session check may take before the wait becomes an error with Retry. */
export const STUCK_MS = 15_000;

/** Server-side minimum (api.routes.auth._MIN_PASSWORD_LENGTH = 12). */
export const MIN_PASSWORD_LENGTH = 12;

/** "Loading Meridian" while the session is checked; a check that never answers becomes an error with Retry. */
function SessionLoading({ onRetry }: { onRetry: () => void }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setStuck(true), STUCK_MS);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="nx-auth-wait">
      {stuck ? (
        <div className="nx-auth-col">
          <ErrorState sentence={t("This is taking longer than expected. The server has not answered the session check. Retry, or check that the API is running.")} onRetry={onRetry} />
        </div>
      ) : (
        // The server renders in English; the browser may already hold a saved language, so the first paint may differ.
        <span role="status" aria-busy="true" aria-label={t("Loading Meridian")} suppressHydrationWarning>
          {t("Loading Meridian")}
        </span>
      )}
    </div>
  );
}

/**
 * The gate of the signed-in interface: signed-out users go to /sign-in, and an account that still has its seeded
 * password changes it first. A session check that fails because the server is down (5xx, network) shows an error
 * with Retry and never signs out. Same checks, in the same order, as the v2 guard it replaces.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading, mustChangePassword, error, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user && !error) router.push("/sign-in");
  }, [isLoading, user, error, router]);

  // Each retry remounts the loading screen, so its timeout starts again.
  const [tries, setTries] = useState(0);

  if (user && mustChangePassword) return <ForcePasswordChange />;
  if (isLoading) return <SessionLoading key={tries} onRetry={() => { setTries((n) => n + 1); retry(); }} />;
  if (!user && error) {
    return (
      <div className="nx-auth-wait">
        <div className="nx-auth-col">
          <ErrorState sentence={t("Could not check your session: {error}", { error })} onRetry={retry} />
        </div>
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}

function PasswordField({ label, value, onChange, autoComplete, hint }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="nx-field">
      <label htmlFor={id}>{label}</label>
      <div className="nx-auth-pw">
        <input id={id} className="nx-input" type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-describedby={hint ? `${id}-hint` : undefined} />
        <Button variant="quiet" size={32} aria-pressed={shown} aria-controls={id} aria-label={shown ? t("Hide password") : t("Show password")} onClick={() => setShown((s) => !s)}>
          {shown ? t("Hide") : t("Show")}
        </Button>
      </div>
      {hint ? <span id={`${id}-hint`} className="nx-auth-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Shown instead of everything else while the account has a password someone else set: the seeded one, or one an
 * admin set or reset (`must_change_password`). The user cannot go anywhere until they set a new one; Sign out is
 * there for someone who arrived here by mistake.
 */
export function ForcePasswordChange() {
  const { changePassword, logout, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError(t("The new password and its confirmation do not match."));
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError(t("Use at least {min} characters", { min: MIN_PASSWORD_LENGTH }));
    if (newPassword === currentPassword) return setError(t("The new password must differ from the current one."));
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err: unknown) {
      const res = (err as { response?: { status?: number; data?: { detail?: string } } })?.response;
      setError(res?.status === 429 ? t("Too many password changes. Wait a minute, then try again.") : res?.data?.detail || t("The password could not be changed. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="nx-auth-wait">
      <div className="nx-auth-col">
        <h1 className="nx-auth-title">{t("Change your password to continue")}</h1>
        <p className="nx-auth-lead">{t("You are signed in as {email}. This password was set for you, by setup or by an admin. Choose your own to use Meridian.", { email: user?.email ?? "" })}</p>
        <form className="nx-form" onSubmit={onSubmit} noValidate>
          {error ? <p className="nx-auth-note" role="alert">{error}</p> : null}
          <PasswordField label={t("Current password")} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField label={t("New password")} value={newPassword} onChange={setNewPassword} autoComplete="new-password" hint={t("At least {min} characters.", { min: MIN_PASSWORD_LENGTH })} />
          <PasswordField label={t("Confirm new password")} value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <div className="nx-auth-row">
            <Button type="submit" variant="primary" loading={submitting} loadingLabel={t("Saving…")}>
              {submitting ? t("Saving…") : t("Change password")}
            </Button>
            <Button onClick={logout}>{t("Sign out")}</Button>
          </div>
        </form>
      </div>
    </main>
  );
}
