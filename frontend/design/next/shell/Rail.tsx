"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useV2Href } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { PATHS, type DestId } from "@/lib/next/nav-defaults";
import { Glyph, LABEL, destAt } from "./dest";

const PIN_KEY = "nx.rail.pin";
/** Hover intent: crossing the rail on the way somewhere opens nothing, and a slip off it does not close it. */
export const OPEN_MS = 120;
export const CLOSE_MS = 200;

const listeners = new Set<() => void>();
const readPin = () => {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false; // private window or blocked storage: stay unpinned
  }
};
function usePinned(): [boolean, (v: boolean) => void] {
  const pinned = useSyncExternalStore((cb) => (listeners.add(cb), () => void listeners.delete(cb)), readPin, () => false);
  return [
    pinned,
    (v) => {
      try {
        localStorage.setItem(PIN_KEY, v ? "1" : "0");
      } catch {
        /* the pin lasts until the next read */
      }
      listeners.forEach((f) => f());
    },
  ];
}

export interface RailProps {
  order: DestId[];
  /** Open attention items, shown on Work. */
  workBadge?: number;
  initial: string;
  onHelp: () => void;
  onAccount: () => void;
}

/** 64 px; opens to 220 on hover or focus, stays open when pinned. Five destinations, a rule, then More, help and you. */
export function Rail({ order, workBadge = 0, initial, onHelp, onAccount }: RailProps) {
  const pathname = usePathname();
  const href = useV2Href();
  const here = destAt(pathname);
  const [pinned, setPinned] = usePinned();
  const [hover, setHover] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const intent = (on: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(on), on ? OPEN_MS : CLOSE_MS);
  };
  const five = order.filter((d) => d !== "more");
  const item = (id: DestId) => (
    <Link key={id} href={href(PATHS[id])} className="nx-rail-item" aria-current={here === id ? "page" : undefined} aria-label={LABEL[id]()}>
      <Glyph id={id} />
      <span className="nx-rail-label">{LABEL[id]()}</span>
      {id === "work" && workBadge > 0 ? <span className="nx-rail-badge" aria-label={t("{n} open", { n: workBadge })}>{workBadge > 99 ? "99+" : workBadge}</span> : null}
    </Link>
  );
  return (
    <nav
      id="nx-rail"
      className="nx-rail"
      aria-label={t("Main")}
      data-open={hover || undefined}
      data-pinned={pinned || undefined}
      onMouseEnter={() => intent(true)}
      onMouseLeave={() => intent(false)}
      onFocus={() => intent(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && intent(false)}
    >
      <div className="nx-rail-in">
        {five.map(item)}
        <hr className="nx-rail-rule" />
        {item("more")}
        <div className="nx-rail-foot">
          <button type="button" className="nx-rail-item" aria-pressed={pinned} onClick={() => setPinned(!pinned)}>
            <svg className="nx-rail-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h12" /></svg>
            <span className="nx-rail-label">{pinned ? t("Unpin the menu") : t("Pin the menu open")}</span>
          </button>
          <button type="button" className="nx-rail-item" onClick={onHelp} aria-label={t("Help")}>
            <svg className="nx-rail-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.5M10 14h.01" /></svg>
            <span className="nx-rail-label">{t("Help")}</span>
          </button>
          <button type="button" className="nx-rail-item" onClick={onAccount} aria-label={t("Account")}>
            <span className="nx-rail-glyph nx-rail-avatar" aria-hidden="true">{initial}</span>
            <span className="nx-rail-label">{t("Account")}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
