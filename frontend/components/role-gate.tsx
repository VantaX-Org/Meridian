"use client";

import { useRole } from "@/hooks/use-role";
import type { Role } from "@/hooks/use-role";

interface RoleGateProps {
  /** Minimum tier required to see children */
  tier?: "admin" | "manager";
  /** Specific permission action required */
  permission?: string;
  /** Fallback to render when access is denied (default: null) */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Conditionally render children based on the current user's role/permissions.
 *
 * Usage:
 *   <RoleGate tier="admin">Admin-only content</RoleGate>
 *   <RoleGate permission="manage_users">User management</RoleGate>
 */
export function RoleGate({ tier, permission, fallback = null, children }: RoleGateProps) {
  const { can, isAdmin, isManager } = useRole();

  if (tier === "admin" && !isAdmin) return <>{fallback}</>;
  if (tier === "manager" && !isManager) return <>{fallback}</>;
  if (permission && !can(permission)) return <>{fallback}</>;

  return <>{children}</>;
}

/**
 * Render a "Permission denied" message inline when the user lacks access.
 * Useful for full-page access control.
 */
export function PermissionDenied({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <span className="text-2xl">🔒</span>
      </div>
      <h2 className="text-lg font-semibold text-foreground">Access Restricted</h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        {message ?? "You don't have permission to view this page. Contact your administrator."}
      </p>
      <a
        href="/"
        className="mt-2 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Back to Dashboard
      </a>
    </div>
  );
}
