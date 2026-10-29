"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { personaForRole, pillSetFor } from "@/lib/persona";
import { fixtureParam, useFixture, withFixture } from "@/lib/api/v2/fixture";

export type OpenKind = "record" | "rule" | "run" | "system" | "feature" | "job" | "batch" | "person" | "inbox" | "triage";
export interface OpenItem {
  kind: OpenKind;
  id: string;
}

const KINDS: readonly OpenKind[] = ["record", "rule", "run", "system", "feature", "job", "batch", "person"];
/** Panels that name no thing: `?open=inbox` and `?open=triage`. Their id is empty. */
const PANELS: readonly OpenKind[] = ["inbox", "triage"];

/** Parses `?open=<kind>:<id>`. The id may itself contain colons (a record id is module:key). Null for anything else. */
export function parseOpen(value: string | null | undefined): OpenItem | null {
  if (!value) return null;
  if ((PANELS as readonly string[]).includes(value)) return { kind: value as OpenKind, id: "" };
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

export type V2Persona = "lead" | "steward" | "basis" | "owner";

export const PERSONA_LABEL: Record<V2Persona, string> = { lead: "Programme lead", steward: "Data steward", basis: "SAP Basis", owner: "Data owner" };

export interface V2Session {
  persona: V2Persona;
  label: string;
  name: string;
  email: string | null;
  /** The signed-in user's id; four eyes compares it with who built a batch. */
  id: string | null;
  can: (action: string) => boolean;
  fixture: boolean;
}

/** Who is looking: the persona the first screen is shaped for, from the role (fixture mode: `?persona=`). */
export function useV2Session(): V2Session {
  const fixture = useFixture();
  const { user } = useAuth();
  const { role, can } = useRole();
  return useMemo(() => {
    if (fixture) {
      const asked = fixtureParam("persona");
      const persona: V2Persona = asked === "steward" || asked === "basis" || asked === "owner" ? asked : "lead";
      return { persona, label: PERSONA_LABEL[persona], name: "Demo user", email: null, id: FIXTURE_ME, can: () => true, fixture };
    }
    const p = personaForRole(role);
    const persona: V2Persona = pillSetFor(role) === "owner" ? "owner" : p === "steward" ? "steward" : p === "basis" ? "basis" : "lead";
    return { persona, label: PERSONA_LABEL[persona], name: user?.name ?? "", email: user?.email ?? null, id: user?.id ?? null, can, fixture };
  }, [fixture, role, can, user]);
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
