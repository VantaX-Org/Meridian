"use client";

import { useState } from "react";
import { useAuth } from "@/context/auth-context";

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
      setError(detail || "Password change failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.72)", backdropFilter: "blur(6px)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fpc-title"
    >
      <div
        className="w-full max-w-md rounded-xl p-6 shadow-2xl"
        style={{
          background: "var(--aurora-canvas-raised, #111726)",
          border: "1px solid var(--aurora-canvas-line, #2a3654)",
        }}
      >
        <h2
          id="fpc-title"
          className="text-xl font-semibold mb-2"
          style={{ color: "var(--aurora-fg-primary, #f7f8fa)" }}
        >
          Change your password to continue
        </h2>
        <p
          className="text-sm mb-5"
          style={{ color: "var(--aurora-fg-secondary, #c7d0dc)" }}
        >
          You&apos;re signed in as <strong>{user?.email}</strong>. This account
          still has its default password; set a new one before you can use
          Meridian.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="block mb-1" style={{ color: "var(--aurora-fg-secondary)" }}>
              Current password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--aurora-canvas-elevated, #172034)",
                border: "1px solid var(--aurora-canvas-line)",
                color: "var(--aurora-fg-primary)",
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="block mb-1" style={{ color: "var(--aurora-fg-secondary)" }}>
              New password (min 12 characters)
            </span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--aurora-canvas-elevated, #172034)",
                border: "1px solid var(--aurora-canvas-line)",
                color: "var(--aurora-fg-primary)",
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="block mb-1" style={{ color: "var(--aurora-fg-secondary)" }}>
              Confirm new password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--aurora-canvas-elevated, #172034)",
                border: "1px solid var(--aurora-canvas-line)",
                color: "var(--aurora-fg-primary)",
              }}
            />
          </label>

          {error && (
            <p className="text-sm" style={{ color: "var(--aurora-status-danger-500)" }}>
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={logout}
              className="text-sm underline"
              style={{ color: "var(--aurora-fg-tertiary)" }}
            >
              Sign out
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md px-5 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                background: "var(--aurora-accent-500, #0057d2)",
                color: "#ffffff",
              }}
            >
              {submitting ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
