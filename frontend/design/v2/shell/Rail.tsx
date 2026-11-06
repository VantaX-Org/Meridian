"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useV2Session } from "@/lib/v2/hooks";
import { canAdminister } from "@/lib/v2/admin-sections";
import { useCounts } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { IconClose } from "../marks";
import { V2Link } from "../parts";
import { destinationAt, destinations, type Destination } from "./menu";
import { ObjectsTree } from "./ObjectsTree";

export type FlyId = Destination["id"] | null;

const PIN_KEY = "m2.rail.pin";

const pinListeners = new Set<() => void>();
const readPin = () => {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false; // private window or blocked storage: stay unpinned
  }
};

/** Pinned-open is a convenience kept in this browser only; it renders unpinned on the server and without storage. */
function usePinned(): [boolean, (v: boolean) => void] {
  const pinned = useSyncExternalStore(
    (cb) => {
      pinListeners.add(cb);
      return () => void pinListeners.delete(cb);
    },
    readPin,
    () => false,
  );
  return [
    pinned,
    (v) => {
      try {
        localStorage.setItem(PIN_KEY, v ? "1" : "0");
      } catch {
        /* the pin lasts until the next read */
      }
      pinListeners.forEach((f) => f());
    },
  ];
}

const ICON: Record<Destination["id"], string> = {
  home: "M2.5 7.5 8 3l5.5 4.5V13h-11Z",
  objects: "M2.5 3.5h11v3.5h-11ZM2.5 9h11v3.5h-11Z", // i18n-ignore: SVG path data
  runs: "M3 13V8M6.5 13V3.5M10 13V6M13.5 13V9.5",
  fix: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM5.5 8l1.8 1.8L10.8 6", // i18n-ignore: SVG path data
  rules: "M3 4.5h10M3 8h10M3 11.5h6",
  master: "M3 4.5c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2ZM3 4.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7", // i18n-ignore: SVG path data
  migration: "M2.5 8h10M9 4.5 12.5 8 9 11.5",
};

function Glyph({ id }: { id: Destination["id"] }) {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" strokeWidth="1.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[id]} />
    </svg>
  );
}

/** Reports, Atlas and Administration: small, below the seven. Administration only for people who can administer. */
function MoreLinks() {
  const pathname = usePathname();
  const { can } = useV2Session();
  const links = [
    { href: "/reports", label: t("Reports") },
    { href: "/atlas", label: t("Atlas") },
    ...(canAdminister(can) ? [{ href: "/admin", label: t("Administration") }] : []),
  ];
  return (
    <nav className="m2-more" aria-label={t("More")}>
      {links.map((l) => (
        <V2Link key={l.href} href={l.href} title={l.label} aria-current={pathname === l.href || pathname.startsWith(`${l.href}/`) ? "page" : undefined}>
          {l.label}
        </V2Link>
      ))}
    </nav>
  );
}

function FlyoutBody({ dest, onClose, pinned, setPinned }: { dest: Destination; onClose: () => void; pinned: boolean; setPinned: (v: boolean) => void }) {
  const pathname = usePathname();
  const fix = useCounts().data?.fix;
  const here = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <aside id="m2-fly" className="m2-fly" aria-label={dest.label} data-testid="flyout">
      <div className="m2-fly-h">
        <V2Link href={dest.href}>{dest.label}</V2Link>
        <button type="button" className="m2-x m2-fly-pin" aria-pressed={pinned} aria-label={pinned ? t("Unpin the menu") : t("Pin the menu open")} onClick={() => setPinned(!pinned)}>
          <span className="m2-x-t">{pinned ? t("Unpin") : t("Pin")}</span>
        </button>
        <button type="button" className="m2-x m2-fly-x" aria-label={t("Close menu")} onClick={onClose}>
          <IconClose />
          <span className="m2-x-t">{t("Close")}</span>
        </button>
      </div>
      <p className="m2-fly-about">{dest.about}</p>
      {dest.id === "objects" ? (
        <ObjectsTree />
      ) : dest.kids.length ? (
        <nav className="m2-mnav" aria-label={dest.label}>
          {dest.kids.map((k) => (
            <V2Link key={k.href} href={k.href} className="m2-mi" aria-current={here(k.href) ? "page" : undefined}>
              <span>{k.label}</span>
              {k.href === "/work" && fix ? <span className="m2-n">{int(fix)}</span> : null}
            </V2Link>
          ))}
        </nav>
      ) : null}
      <div className="m2-fly-more">
        <MoreLinks />
      </div>
    </aside>
  );
}

/**
 * The rail: seven destinations, icon over label, always visible from 1100 px. Hovering or focusing one opens its
 * flyout; clicking goes to its landing route. Narrower than that the rail is the bottom bar and the flyout a sheet.
 */
export function Rail({ fly, setFly }: { fly: FlyId; setFly: (id: FlyId) => void }) {
  const pathname = usePathname();
  const [pinned, setPinned] = usePinned();
  const fix = useCounts().data?.fix;
  const all = destinations();
  const active = destinationAt(pathname, all);
  const shown = all.find((d) => d.id === (fly ?? (pinned ? active?.id ?? "objects" : null)));
  return (
    <div
      className="m2-railwrap"
      data-pinned={pinned && shown ? "" : undefined}
      onMouseLeave={() => setFly(null)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFly(null);
      }}
    >
      <nav id="m2-rail" className="m2-rail" aria-label={t("Main")} data-testid="rail">
        <div className="m2-rail-d">
          {all.map((d) => (
            <V2Link
              key={d.id}
              href={d.href}
              className="m2-rail-i"
              aria-current={active?.id === d.id ? "page" : undefined}
              aria-controls={shown?.id === d.id ? "m2-fly" : undefined}
              aria-expanded={shown?.id === d.id}
              onMouseEnter={() => setFly(d.id)}
              onFocus={() => setFly(d.id)}
            >
              <Glyph id={d.id} />
              <span>{d.label}</span>
              {d.id === "fix" && fix ? <span className="m2-n">{int(fix)}</span> : null}
            </V2Link>
          ))}
        </div>
        <MoreLinks />
      </nav>
      {shown ? <FlyoutBody dest={shown} onClose={() => setFly(null)} pinned={pinned} setPinned={setPinned} /> : null}
    </div>
  );
}

/** Under 1100 px the seven destinations are a bar at thumb height; each opens its flyout as a sheet. */
export function BottomTabs({ fly, setFly }: { fly: FlyId; setFly: (id: FlyId) => void }) {
  const pathname = usePathname();
  const active = destinationAt(pathname, destinations());
  return (
    <nav className="m2-ptabs" aria-label={t("Main, bottom bar")} data-testid="bottom-tabs">
      {destinations().map((d) => (
        <button key={d.id} type="button" aria-haspopup="dialog" aria-expanded={fly === d.id} aria-current={active?.id === d.id ? "page" : undefined} onClick={() => setFly(fly === d.id ? null : d.id)}>
          <Glyph id={d.id} />
          <span>{d.label}</span>
        </button>
      ))}
    </nav>
  );
}
