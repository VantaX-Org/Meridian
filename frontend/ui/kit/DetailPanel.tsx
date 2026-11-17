"use client";

import type { ReactNode } from "react";
import { Tabs, type TabItem } from "./Tabs";

/** The detail of the selected row: a header (severity and title), tabs, and the active panel as children. */
export function DetailPanel({ idBase, label, header, tabsLabel, tabs, value, onChange, children }: { idBase: string; label: string; header: ReactNode; tabsLabel: string; tabs: TabItem[]; value: string; onChange: (id: string) => void; children: ReactNode }) {
  return (
    <section className="mx-card mx-detail" aria-label={label}>
      <header className="mx-detail-h">{header}</header>
      <Tabs idBase={idBase} label={tabsLabel} items={tabs} value={value} onChange={onChange} />
      <div id={`${idBase}-panel-${value}`} role="tabpanel" aria-labelledby={`${idBase}-tab-${value}`} className="mx-panel">{children}</div>
    </section>
  );
}
