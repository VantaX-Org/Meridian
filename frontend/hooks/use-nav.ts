"use client";

import { useRole } from "@/hooks/use-role";
import { useLicence } from "@/hooks/use-licence";
import { usePermissionsContext } from "@/lib/permissions";
import { visibleNav, type NavGate, type NavGroup } from "@/lib/nav";

/** Role + licence + resource gate for nav items, from the signed-in user. */
export function useNavGate(): NavGate {
  const { can } = useRole();
  const { isMenuItemEnabled } = useLicence();
  const perms = usePermissionsContext();
  // No provider (component tests): `requires` is not checked. Inside one, `has` fails closed until loaded.
  return perms ? { can, isMenuItemEnabled, has: perms.has } : { can, isMenuItemEnabled };
}

/** True while /me/permissions loads; the Rail shows its skeleton instead of the nav. */
export function useNavLoading(): boolean {
  return usePermissionsContext()?.loading ?? false;
}

/** The shared nav (lib/nav.ts) filtered for the signed-in user. */
export function useVisibleNav(): NavGroup[] {
  return visibleNav(useNavGate());
}
