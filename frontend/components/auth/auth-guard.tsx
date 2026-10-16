"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/design";
import { useAuth } from "@/context/auth-context";
import { ForcePasswordChange } from "@/components/force-password-change";
import { UpdateAvailableModal } from "@/components/update-available-modal";
import { UpdateModalProvider } from "@/context/update-modal-context";

/**
 * Gate for everything under `app/(app)`: signed-out users go to /sign-in,
 * a seeded password must be rotated first, and the update modal lives here
 * so it can appear over any page. A session check that fails because the
 * server is down (5xx, network) shows an error with Retry and never signs out.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, mustChangePassword, error, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user && !error) router.push("/sign-in");
  }, [isLoading, user, error, router]);

  if (user && mustChangePassword) return <ForcePasswordChange />;
  if (isLoading) {
    return (
      <div
        className="flex h-screen items-center justify-center m-text-body"
        style={{ background: "var(--m-canvas)", color: "var(--m-ink-3)" }}
        role="status"
        aria-label="Loading Meridian"
      >
        Loading Meridian
      </div>
    );
  }
  if (!user && error) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--m-canvas)" }}>
        <ErrorState title="Could not check your session." message={error} onRetry={retry} />
      </div>
    );
  }
  if (!user) return null;

  return (
    <UpdateModalProvider>
      {children}
      <UpdateAvailableModal />
    </UpdateModalProvider>
  );
}
