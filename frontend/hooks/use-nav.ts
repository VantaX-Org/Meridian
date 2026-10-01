"use client";

import { useRole } from "@/hooks/use-role";
import { useLicence } from "@/hooks/use-licence";
import { visibleNav, type NavGate, type NavGroup } from "@/lib/nav";

/** Role + licence gate for nav items, from the signed-in user. */
export function useNavGate(): NavGate {
  const { can } = useRole();
  const { isMenuItemEnabled } = useLicence();
  return { can, isMenuItemEnabled };
}

/** The shared nav (lib/nav.ts) filtered for the signed-in user. */
export function useVisibleNav(): NavGroup[] {
  return visibleNav(useNavGate());
}
