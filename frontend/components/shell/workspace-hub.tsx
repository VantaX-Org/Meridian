"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tabs, Text } from "@/components/aurora";
import { PermissionDenied } from "@/components/role-gate";
import { useNavGate } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { LANDING, tabHref, visibleWorkspaces, type WorkspaceId } from "@/lib/workspaces";
import { AURORA_TABS, TAB_BODIES } from "./tab-bodies";

const LANDED_KEY = "mn_landed";

/**
 * One workspace: its tab bar (URL-synced via ?tab=) and the active tab's body.
 * Tabs the user may not open are not rendered; a workspace with none shows
 * the access message instead of an empty frame.
 */
export function WorkspaceHub({ id, landing = false }: { id: WorkspaceId; landing?: boolean }) {
  const router = useRouter();
  const { role } = useRole();
  const gate = useNavGate();
  const all = visibleWorkspaces(gate);
  const workspace = all.find((w) => w.id === id);
  const [tabParam, setTab] = useUrlState("tab", "");
  const tabs = workspace?.tabs.filter((t) => !t.hidden) ?? [];
  const active = tabs.find((t) => t.id === tabParam) ?? tabs[0];

  // First arrival at "/" in this browser session goes to the role's own workspace.
  useEffect(() => {
    if (!landing) return;
    try {
      if (sessionStorage.getItem(LANDED_KEY)) return;
      sessionStorage.setItem(LANDED_KEY, "1");
    } catch {
      return;
    }
    if (LANDING[role] !== "/") router.replace(LANDING[role]);
  }, [landing, role, router]);

  // A tab that moved to another workspace (old bookmark, e.g. /?tab=findings) follows it there.
  const owner = tabParam && !tabs.some((t) => t.id === tabParam)
    ? all.find((w) => w.tabs.some((t) => t.id === tabParam)) : undefined;
  useEffect(() => {
    if (!owner) return;
    const q = new URLSearchParams(window.location.search);
    q.delete("tab");
    const base = tabHref(owner, owner.tabs.find((t) => t.id === tabParam)!);
    const rest = q.toString();
    router.replace(rest ? `${base}${base.includes("?") ? "&" : "?"}${rest}` : base);
  }, [owner, tabParam, router]);

  if (!workspace || !active) {
    return <PermissionDenied message="Nothing in this workspace is open to your role." />;
  }
  const Body = TAB_BODIES[active.href];
  return (
    <div className="aurora-hub">
      <div className="aurora-hub__bar">
        <Text as="h1" variant="display-sm" className="aurora-hub__title">{workspace.label}</Text>
        <Tabs
          ariaLabel={`${workspace.label} tabs`}
          items={tabs.map((t) => ({ id: t.id, label: t.label }))}
          value={active.id}
          onValueChange={setTab}
        />
      </div>
      {AURORA_TABS.has(active.href) ? (Body ? <Body /> : null) : (
        <div className="mn-legacy-host">
          {Body ? <Body /> : null}
        </div>
      )}
    </div>
  );
}
