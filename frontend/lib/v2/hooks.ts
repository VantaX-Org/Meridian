"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { isRole, useRole } from "@/hooks/use-role";
import { personaForRole, pillSetFor } from "@/lib/persona";
import { fixtureParam, useFixture, withFixture } from "@/lib/api/v2/fixture";
import { usePersonaOverride } from "./prefs";
import { actionsOf, useShareMode, useViewAs } from "./view-as";
import { t } from "@/lib/v2/i18n";

export type OpenKind = "record" | "rule" | "run" | "system" | "feature" | "job" | "batch" | "person" | "inbox" | "triage" | "golden" | "term" | "step" | "connection" | "config" | "syncschedule" | "zobject" | "survivorship" | AdminKind;
/** The administration, report and panel kinds: `?open=user:<id>` and so on. `preferences`, `help` and `waves` carry no id. */
export type AdminKind = "user" | "role" | "apikey" | "audit" | "channel" | "mapping" | "report" | "schedule" | "preferences" | "help" | "waves" | RoleKind;
/** Step 6c: a data contract (`contract:<id>`), and the bare panels: contracts, balance work, out of office. */
export type RoleKind = "contract" | "contracts" | "balance" | "away";
/** Kinds written without an id: `?open=preferences`. */
export const BARE_KINDS: readonly OpenKind[] = ["inbox", "triage", "preferences", "help", "waves", "contracts", "balance", "away"];
export interface OpenItem {
  kind: OpenKind;
  id: string;
}

const KINDS: readonly OpenKind[] = ["record", "rule", "run", "system", "feature", "job", "batch", "person", "golden", "term", "step", "user", "role", "apikey", "audit", "channel", "mapping", "report", "schedule", "connection", "config", "syncschedule", "zobject", "survivorship", "contract"];

/** Parses `?open=<kind>:<id>`. The id may itself contain colons (a record id is module:key). Null for anything else. */
export function parseOpen(value: string | null | undefined): OpenItem | null {
  if (!value) return null;
  if ((BARE_KINDS as readonly string[]).includes(value)) return { kind: value as OpenKind, id: "" };
  const at = value.indexOf(":");
  if (at <= 0) return null;
  const kind = value.slice(0, at) as OpenKind;
  const id = value.slice(at + 1);
  return KINDS.includes(kind) && id ? { kind, id } : null;
}

export const formatOpen = (item: OpenItem): string => (item.id ? `${item.kind}:${item.id}` : item.kind);

/** Returns a function that adds `fixture=1` to a v2 href when the page is in fixture mode. Other hrefs pass through. */
export function useV2Href(): (href: string) => string {
  const fixture = useFixture();
  return useCallback((href: string) => (/^\/v2(?:[/?#]|$)/.test(href) ? withFixture(href, fixture) : href), [fixture]);
}

/** The inspector's state is the URL: `?open=kind:id`. Opening and closing replace the entry, so Back leaves the page. */
export function useOpenItem(): { open: OpenItem | null; openItem: (item: OpenItem) => void; close: () => void; hrefFor: (item: OpenItem) => string } {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = useMemo(() => parseOpen(params.get("open")), [params]);
  const build = useCallback(
    (item: OpenItem | null) => {
      const next = new URLSearchParams(params.toString());
      if (item) next.set("open", formatOpen(item));
      else next.delete("open");
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );
  const openItem = useCallback((item: OpenItem) => router.replace(build(item), { scroll: false }), [router, build]);
  const close = useCallback(() => router.replace(build(null), { scroll: false }), [router, build]);
  const hrefFor = useCallback((item: OpenItem) => build(item), [build]);
  return { open, openItem, close, hrefFor };
}

/** The fixture user's id: the "me" row of People and the author the owner persona cannot approve for. */
export const FIXTURE_ME = "u-me";

export type V2Persona = "lead" | "steward" | "basis" | "owner" | "process";

export const PERSONA_LABEL: Record<V2Persona, string> = { get lead() { return t("Programme lead"); }, get steward() { return t("Data steward"); }, get basis() { return t("SAP Basis"); }, get owner() { return t("Data owner"); }, get process() { return t("Process analyst"); } };

export interface V2Session {
  persona: V2Persona;
  label: string;
  name: string;
  email: string | null;
  /** The signed-in user's id; four eyes compares it with who built a batch. */
  id: string | null;
  can: (action: string) => boolean;
  fixture: boolean;
  /** The role an administrator is viewing as (support), or null. Writes are refused while it is set. */
  viewAs: string | null;
  /** True on a page opened from a share link: read-only, viewer role. */
  shared: boolean;
}

/** Persona of a role key, the way the live session derives it. */
function personaOf(role: string): V2Persona {
  if (!isRole(role)) return "lead";
  const p = personaForRole(role);
  return pillSetFor(role) === "owner" ? "owner" : p === "steward" ? "steward" : p === "basis" ? "basis" : p === "process" ? "process" : "lead";
}

/** Who is looking: the persona the first screen is shaped for, from the role (fixture mode: `?persona=`). */
export function useV2Session(): V2Session {
  const fixture = useFixture();
  const { user } = useAuth();
  const { role, can } = useRole();
  const chosen = usePersonaOverride();
  const viewAs = useViewAs();
  const share = useShareMode();
  return useMemo(() => {
    const shared = share !== null;
    if (fixture) {
      // `?role=` gives fixture mode one role's permissions (the role tests walk each role's jobs this way).
      const asRole = shared ? "viewer" : (viewAs ?? fixtureParam("role"));
      const asked = fixtureParam("persona");
      const persona: V2Persona = asked === "steward" || asked === "basis" || asked === "owner" || asked === "process" || asked === "lead" ? asked : asRole ? personaOf(asRole) : (chosen ?? "lead");
      const allowed = asRole ? new Set(actionsOf(asRole)) : null;
      return { persona, label: PERSONA_LABEL[persona], name: t("Demo user"), email: null, id: FIXTURE_ME, can: allowed ? (a: string) => allowed.has(a) : () => true, fixture, viewAs, shared };
    }
    // Live: a view-as role is narrowed by the server (/me/permissions answers for it); a share link narrows here.
    const viewer = new Set(actionsOf("viewer"));
    const live = shared ? (a: string) => viewer.has(a) && can(a) : can;
    const persona: V2Persona = chosen ?? personaOf(viewAs ?? role);
    return { persona, label: PERSONA_LABEL[persona], name: user?.name ?? "", email: user?.email ?? null, id: user?.id ?? null, can: live, fixture, viewAs, shared };
  }, [fixture, role, can, user, chosen, viewAs, share]);
}

/** The run the page is pinned to (`?run=`), or null for the current state. */
export function useRunParam(): string | null {
  return useSearchParams().get("run");
}

const PHONE = "(max-width: 760px)";
const subscribePhone = (cb: () => void) => {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** True at phone width, where the map is a bottom sheet, the inspector fills the screen and the ledger is a list. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches,
    () => false,
  );
}
