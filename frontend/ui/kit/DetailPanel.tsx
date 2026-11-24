"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Tabs, type TabItem } from "./Tabs";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * The detail of the selected row: a header (severity and title), tabs, and the active panel as children.
 * With `side` it becomes the one side panel: it opens from the right, keeps the grid visible, keeps Tab inside,
 * Escape calls `onClose`, and J and K call `onNext` and `onPrev` without closing. The open row lives in the URL
 * through useGridState(key).open, so the caller passes that in and out.
 */
export function DetailPanel({ idBase, label, header, tabsLabel, tabs, value, onChange, children, side, onClose, onPrev, onNext }: {
  idBase: string; label: string; header: ReactNode; tabsLabel: string; tabs: TabItem[]; value: string; onChange: (id: string) => void; children: ReactNode;
  side?: boolean; onClose?: () => void; onPrev?: () => void; onNext?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const back = useRef<Element | null>(null);
  useEffect(() => {
    if (!side) return;
    back.current = document.activeElement;
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root)?.focus();
    return () => { if (back.current instanceof HTMLElement) back.current.focus(); };
  }, [side]);
  const key = (e: React.KeyboardEvent) => {
    if (!side) return;
    if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
    if (e.key === "Tab") {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      return;
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "j" || e.key === "J") { e.preventDefault(); onNext?.(); }
    else if (e.key === "k" || e.key === "K") { e.preventDefault(); onPrev?.(); }
  };
  return (
    <section ref={ref} className="mx-card mx-detail" data-side={side ? "" : undefined} tabIndex={side ? -1 : undefined} aria-label={label} onKeyDown={key}>
      <header className="mx-detail-h">{header}</header>
      <Tabs idBase={idBase} label={tabsLabel} items={tabs} value={value} onChange={onChange} />
      <div id={`${idBase}-panel-${value}`} role="tabpanel" aria-labelledby={`${idBase}-tab-${value}`} className="mx-panel">{children}</div>
    </section>
  );
}
