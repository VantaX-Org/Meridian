"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { ForcePasswordChange } from "@/components/force-password-change";
import { UpdateAvailableModal } from "@/components/update-available-modal";
import { UpdateModalProvider } from "@/context/update-modal-context";

/**
 * Gate for everything under `app/(app)`: signed-out users go to /sign-in,
 * a seeded password must be rotated first, and the update modal lives here
 * so it can appear over any page.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.push("/sign-in");
  }, [isLoading, user, router]);

  if (user && mustChangePassword) return <ForcePasswordChange />;
  if (isLoading) {
    return (
      <div
        className="flex h-screen items-center justify-center text-[13px]"
        style={{ background: "var(--m-canvas)", color: "var(--m-ink-3)" }}
        role="status"
        aria-label="Loading Meridian"
      >
        Loading Meridian
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
