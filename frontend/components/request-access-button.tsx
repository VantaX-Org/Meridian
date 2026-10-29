"use client";

import { Button } from "@/design";
import { usePermissionsContext } from "@/lib/permissions";

/**
 * The way forward from a read-only state: opens the Request access dialog for one (resource, action), the same flow the
 * gated primaries use. Nothing while the grants load or outside the provider, so a banner never offers a dead button.
 */
export function RequestAccessButton({ resource, action, label = "Request access", variant = "secondary", size = "sm" }: {
  resource: string;
  action: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const perms = usePermissionsContext();
  if (!perms || perms.loading) return null;
  return (
    <Button variant={variant} size={size} onClick={() => perms.requestAccess({ resource, action })}>
      {label}
    </Button>
  );
}
