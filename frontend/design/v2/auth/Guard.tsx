"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { t } from "@/lib/v2/i18n";
import { ErrorFrame } from "../parts";
import { AuthFrame, AuthNote, PasswordField } from "./AuthFrame";
import { MIN_PASSWORD_LENGTH } from "./SetPassword";

/** How long the session check may take before the wait becomes an error with Retry. */
export const STUCK_MS = 15_000;

/** "Loading Meridian" while the session is checked; a check that never answers becomes an error with Retry. */
function SessionLoading({ onRetry }: { onRetry: () => void }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setStuck(true), STUCK_MS);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="m2-auth-wait">
      {stuck ? (
        <div className="m2-auth-col">
          <ErrorFrame onRetry={onRetry}>{t("This is taking longer than expected. The server has not answered the session check. Retry, or check that the API is running.")}</ErrorFrame>
        </div>
      ) : (
        <span role="status" aria-busy="true" aria-label={t("Loading Meridian")}>
          {t("Loading Meridian")}
        </span>
      )}
    </div>
  );
}

/**
 * The gate of the signed-in interface: signed-out users go to /sign-in, and an account that still has its seeded
 * password changes it first. A session check that fails because the server is down (5xx, network) shows an error
 * with Retry and never signs out.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
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
      <div className="m2-auth-wait">
        <div className="m2-auth-col">
          <ErrorFrame onRetry={retry}>{t("Could not check your session: {error}", { error })}</ErrorFrame>
        </div>
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}

/**
 * Shown instead of everything else while the account still has its seeded password (`must_change_password`). The
 * user cannot go anywhere until they set a new one; Sign out is there for someone who arrived here by mistake.
 */
export function ForcePasswordChange() {
  const { changePassword, logout, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError(t("The new password and its confirmation do not match."));
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError(t("Use at least {min} characters", { min: MIN_PASSWORD_LENGTH }));
    if (newPassword === currentPassword) return setError(t("The new password must differ from the current one."));
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || t("The password could not be changed. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame title={t("Change your password to continue")} lead={t("You are signed in as {email}. This account still has its default password. Set a new one to use Meridian.", { email: user?.email ?? "" })}>
      <form className="m2-auth-form" onSubmit={onSubmit} noValidate>
        {error ? <AuthNote tone="danger">{error}</AuthNote> : null}
        <PasswordField label={t("Current password")} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField label={t("New password")} value={newPassword} onChange={setNewPassword} autoComplete="new-password" hint={t("At least {min} characters.", { min: MIN_PASSWORD_LENGTH })} />
        <PasswordField label={t("Confirm new password")} value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <div className="m2-auth-row">
          <button type="submit" className="m2-btn m2-next" disabled={submitting}>
            {submitting ? t("Saving…") : t("Change password")}
          </button>
          <button type="button" className="m2-btn" onClick={logout}>
            {t("Sign out")}
          </button>
        </div>
      </form>
    </AuthFrame>
  );
}
