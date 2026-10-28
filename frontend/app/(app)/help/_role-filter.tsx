"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Checkbox } from "@/design";
import { useRole } from "@/hooks/use-role";
import { roleLabel } from "@/lib/roles";

/**
 * "Only my role": narrows the table of contents to the chapters written for the viewer's role
 * (plus the ones written for everyone). The filter is URL state (?role=), so the page can stay a
 * server component reading markdown from disk; this island only writes the parameter.
 */
export function RoleFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const { homeRole, loading } = useRole();
  const on = params.get("role") === homeRole;
  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    if (on) {
      next.delete("role");
    } else {
      if (!homeRole) return;
      next.set("role", homeRole);
    }
    router.replace(`/help?${next.toString()}`, { scroll: false });
  };
  if (loading || !homeRole) return null;
  return (
    <label className="flex items-center gap-2 m-text-body m-ink-2">
      <Checkbox aria-label="Only my role" checked={on} onChange={toggle} disabled={!homeRole} />
      Only for {roleLabel(homeRole)}
    </label>
  );
}
