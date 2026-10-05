"use client";

import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui-core";
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
    <div className="ui-page">
      <PageHeader title="Access restricted" />
      <EmptyState action={<Link href="/" className="aurora-button aurora-focus-ring" data-variant="primary" data-size="md"><span>Back to the Command Centre</span></Link>}>
        {message ?? "You do not have permission to view this page. Contact your administrator."}
      </EmptyState>
    </div>
  );
}
