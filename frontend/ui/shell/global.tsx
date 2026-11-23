"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { browserTimezone, formatDate, relativeTime, systemTypeLabel } from "@/lib/format";
import { usePreferences } from "@/hooks/use-preferences";
import { useMarkRead, useNotifications, useUnread } from "@/lib/v2/approvals-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { ANY_SYSTEM, int, systemSlug } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { ContextSwitcher, type ContextSystem } from "@/ui/kit/ContextSwitcher";
import { envCode } from "@/ui/kit/EnvBadge";
import { Popover } from "@/ui/kit/Popover";
import type { Theme, DensityTier } from "@/lib/preferences";
import type { SAPSystemExtended } from "@/types/api";

const ENV_TITLE = (code: string) => (code === "PRD" ? t("Production system") : code === "QAS" ? t("Quality assurance system") : code === "DEV" ? t("Development system") : "");

/** The system in the URL: /o/<slug>/... or ?system=<slug>. Null means all systems. */
export function useCurrentSystem(): { systems: SAPSystemExtended[]; current: SAPSystemExtended | null } {
  const path = usePathname() ?? "";
  const qs = useSearchParams();
  const systems = useSystemsExtended().data ?? [];
  const slug = path.startsWith("/o/") ? path.split("/")[2] : qs?.get("system");
  const current = slug && slug !== ANY_SYSTEM ? systems.find((s) => systemSlug(s.name) === slug) ?? null : null;
  return { systems, current };
}

/** Context switcher over the real connected systems only. The choice lives in the URL. */
export function SystemSwitcher() {
  const fx = useFixture();
  const router = useRouter();
  const path = usePathname() ?? "";
  const qs = useSearchParams();
  const { systems, current } = useCurrentSystem();
  const rows: ContextSystem[] = systems.map((s) => ({ id: s.id, name: s.name, typeLabel: systemTypeLabel(s.system_type), environment: s.environment, lastRun: s.last_sync_at ? relativeTime(s.last_sync_at) : null }));
  if (rows.length === 0) return null;
  const select = (id: string | null) => {
    const sys = systems.find((s) => s.id === id);
    const slug = sys ? systemSlug(sys.name) : null;
    if (path.startsWith("/o/")) {
      const parts = path.split("/");
      parts[2] = slug ?? ANY_SYSTEM;
      const rest = qs?.toString();
      router.push(withFixture(`${parts.join("/")}${rest ? `?${rest}` : ""}`, fx));
      return;
    }
    const next = new URLSearchParams(qs?.toString());
    if (slug) next.set("system", slug); else next.delete("system");
    const q = next.toString();
    router.push(withFixture(`${path}${q ? `?${q}` : ""}`, fx));
  };
  return <ContextSwitcher systems={rows} current={current?.id ?? null} onSelect={select} label={t("Switch system")} allLabel={t("All systems")} searchLabel={t("Search systems")} envTitle={ENV_TITLE} />;
}

/** Environment of the selected system, only when its record carries one. */
export function envOf(system: SAPSystemExtended | null): "PROD" | "QA" | "DEV" | null {
  return envCode(system?.environment);
}

/** Bell with the unread count. The panel lists the newest notifications; it needs no second source. */
export function NotificationsBell() {
  const fx = useFixture();
  const unread = useUnread().data?.count;
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [open, setOpen] = useState(false);
  const list = useNotifications(open).data?.items ?? [];
  const mark = useMarkRead();
  const shown = tab === "unread" ? list.filter((n) => !n.is_read) : list;
  const n = unread ? int(unread) : "";
  return (
    <Popover label={t("Notifications {count}, unread", { count: unread === undefined ? "—" : int(unread) })} className="mx-bell" triggerClassName="mx-gbtn" panelClassName="mx-bell-panel"
      triggerProps={{ "data-testid": "inbox" }} trigger={<span aria-hidden="true">{t("Inbox")}{n ? <b className="mx-count">{n}</b> : null}</span>}>
      {(close) => <BellBody tab={tab} setTab={setTab} onOpen={() => setOpen(true)} shown={shown} markAll={() => mark.all.mutate()} markOne={(id) => mark.one.mutate(id)} close={close} href={withFixture("/me/notifications", fx)} />}
    </Popover>
  );
}

function BellBody({ tab, setTab, onOpen, shown, markAll, markOne, close, href }: { tab: "all" | "unread"; setTab: (t: "all" | "unread") => void; onOpen: () => void; shown: { id: string; title: string; body: string; link: string | null; is_read: boolean; created_at: string }[]; markAll: () => void; markOne: (id: string) => void; close: () => void; href: string }) {
  useEffect(onOpen, [onOpen]);
  return (
    <>
      <div className="mx-bell-head">
        <div role="tablist" aria-label={t("Notifications")} className="mx-tabs-mini">
          {(["all", "unread"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k === "all" ? t("All") : t("Unread")}</button>)}
        </div>
        <button type="button" className="mx-linkbtn" onClick={markAll}>{t("Mark all read")}</button>
      </div>
      <ul className="mx-bell-list">
        {shown.length === 0 ? <li className="mx-muted">{t("Nothing here.")}</li> : shown.slice(0, 8).map((n) => (
          <li key={n.id} data-read={n.is_read ? "" : undefined}>
            {n.link ? <Link href={n.link} onClick={() => { markOne(n.id); close(); }}><strong>{n.title}</strong><span className="mx-muted">{n.body}</span></Link> : <button type="button" onClick={() => markOne(n.id)}><strong>{n.title}</strong><span className="mx-muted">{n.body}</span></button>}
            <time className="mx-muted" dateTime={n.created_at}>{relativeTime(n.created_at)}</time>
          </li>
        ))}
      </ul>
      <Link href={href} className="mx-menuitem" onClick={close}>{t("Open inbox")}</Link>
    </>
  );
}

// i18n-ignore: language names stay in their own language.
const LANGS = [{ v: "en", l: "English" }, { v: "de-DE", l: "Deutsch" }, { v: "ja-JP", l: "日本語" }];
const ZONES = ["UTC", "Africa/Johannesburg", "Europe/London", "Europe/Berlin", "America/New_York", "Asia/Tokyo"];

/** Locale clock: the time in the working zone; the panel changes language, zone, theme and density. */
export function LocaleClock({ inMenu = false }: { inMenu?: boolean }) {
  const { prefs, update } = usePreferences();
  const zone = prefs.timezone ?? browserTimezone();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { const tick = () => setNow(new Date()); const first = window.setTimeout(tick, 0); const id = window.setInterval(tick, 30_000); return () => { window.clearTimeout(first); window.clearInterval(id); }; }, []);
  const zones = useMemo(() => Array.from(new Set([zone, ...ZONES])), [zone]);
  const time = now ? formatDate(now, "time", zone) : "";
  const controls = (
    <div className="mx-loc">
      <label>{t("Language")}<select className="mx-select" value={LANGS.find((x) => x.v === prefs.locale)?.v ?? "en"} onChange={(e) => update({ locale: e.target.value })}>{LANGS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></label>
      <label>{t("Time zone")}<select className="mx-select" value={zone} onChange={(e) => update({ timezone: e.target.value })}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
      <label>{t("Theme")}<select className="mx-select" value={prefs.theme ?? "light"} onChange={(e) => update({ theme: e.target.value as Theme })}>{(["light", "dark", "system"] as const).map((v) => <option key={v} value={v}>{v === "light" ? t("Light") : v === "dark" ? t("Dark") : t("System")}</option>)}</select></label>
      <label>{t("Density")}<select className="mx-select" value={prefs.density ?? "default"} onChange={(e) => update({ density: e.target.value as DensityTier })}>{(["compact", "default", "comfortable"] as const).map((v) => <option key={v} value={v}>{v === "compact" ? t("Compact") : v === "default" ? t("Default") : t("Comfortable")}</option>)}</select></label>
      {now ? <p className="mx-muted">{t("Format preview")}: {formatDate(now, "datetime", zone)}</p> : null}
    </div>
  );
  if (inMenu) return controls;
  return <Popover label={t("Language, time zone and display")} className="mx-locale" triggerClassName="mx-gbtn" panelClassName="mx-loc-panel" trigger={<span>{time}</span>}>{() => controls}</Popover>;
}

/** Cmd K on macOS, Ctrl K elsewhere. */
export function searchHint(): string {
  const nav = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad/i.test(nav) ? "⌘ K" : "Ctrl K"; // i18n-ignore
}
