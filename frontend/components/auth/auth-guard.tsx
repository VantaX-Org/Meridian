"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/design";
import { useLoadingTimeout } from "@/design/hooks/useLoadingTimeout";
import { useAuth } from "@/context/auth-context";
import { ForcePasswordChange } from "@/components/force-password-change";
import { ForceTwoFactorSetup } from "@/components/force-two-factor-setup";
import { UpdateAvailableModal } from "@/components/update-available-modal";
import { UpdateModalProvider } from "@/context/update-modal-context";

/**
 * The "Loading Meridian" screen while the session is checked. A check that never answers becomes an error with
 * Retry after the same timeout the page frames use, instead of a blank page for ever.
 */
function SessionLoading({ onRetry }: { onRetry: () => void }) {
  const stuck = useLoadingTimeout(true);
  if (stuck) {
    return (
      <div className="flex h-screen items-center justify-center [background:var(--m-canvas)]">
        <ErrorState title="This is taking longer than expected." message="The server has not answered the session check. Retry, or check that the API is running." onRetry={onRetry} />
      </div>
    );
  }
  return (
    <div
      className="flex h-screen items-center justify-center m-text-body m-ink-3 [background:var(--m-canvas)]"
      role="status"
      aria-busy="true"
      aria-label="Loading Meridian"
    >
      Loading Meridian
    </div>
  );
}

/**
 * Gate for everything under `app/(app)`: signed-out users go to /sign-in,
 * a seeded password must be rotated first, then two-factor sign-in set up when
 * the organisation requires it, and the update modal lives here
 * so it can appear over any page. A session check that fails because the
 * server is down (5xx, network) shows an error with Retry and never signs out.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, mustChangePassword, mustEnrolTwoFactor, error, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user && !error) router.push("/sign-in");
  }, [isLoading, user, error, router]);

  // Each retry remounts the loading screen, so its timeout starts again.
  const [tries, setTries] = useState(0);

  if (user && mustChangePassword) return <ForcePasswordChange />;
  if (user && mustEnrolTwoFactor) return <ForceTwoFactorSetup />;
  if (isLoading) return <SessionLoading key={tries} onRetry={() => { setTries((n) => n + 1); retry(); }} />;
  if (!user && error) {
    return (
      <div className="flex h-screen items-center justify-center [background:var(--m-canvas)]">
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
