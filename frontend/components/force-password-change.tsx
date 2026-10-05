"use client";

import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import { AuthFrame, PasswordField } from "@/components/auth/auth-frame";
import { Banner, Button } from "@/components/ui-core";

/**
 * Blocking overlay shown when the current user's account still has the
 * default seeded password (backend flag `must_change_password=true`).
 *
 * Nothing else renders while this is up — the user cannot navigate,
 * cannot use the command palette, cannot log out (we want them to rotate,
 * not bail). They can, however, explicitly sign out via the button
 * below if they've hit this screen by mistake.
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

    if (newPassword !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (newPassword.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must differ from the current one.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Password change failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame title="Change your password to continue"
      lead={<>You are signed in as {user?.email}. This account still has its default password. Set a new one to use Meridian.</>}>
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" helper="At least 12 characters." />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <div className="ui-form__actions">
          <Button type="submit" disabled={submitting}>{submitting ? "Saving" : "Change password"}</Button>
          <Button type="button" variant="ghost" onClick={logout}>Sign out</Button>
        </div>
      </form>
    </AuthFrame>
  );
}
