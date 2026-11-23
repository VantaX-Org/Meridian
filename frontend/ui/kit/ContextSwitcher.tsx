"use client";

import { useState } from "react";
import { EnvBadge } from "./EnvBadge";
import { Popover } from "./Popover";

export interface ContextSystem { id: string; name: string; typeLabel: string; environment?: string | null; lastRun?: string | null }

/** Which system the screens are about. Lists "All systems" first, then only the real connected systems. */
export function ContextSwitcher({ systems, current, onSelect, label, allLabel, searchLabel, envTitle }: {
  systems: ContextSystem[]; current: string | null; onSelect: (id: string | null) => void;
  label: string; allLabel: string; searchLabel: string; envTitle: (code: string) => string;
}) {
  const now = systems.find((s) => s.id === current);
  return (
    <Popover label={label} className="mx-ctx" triggerClassName="mx-gbtn" /* i18n-ignore */ align="start" panelClassName="mx-ctx-panel" trigger={<span>{now?.name ?? allLabel}</span>}>
      {(close) => <List systems={systems} current={current} allLabel={allLabel} searchLabel={searchLabel} envTitle={envTitle} pick={(id) => { close(); onSelect(id); }} />}
    </Popover>
  );
}

function List({ systems, current, pick, allLabel, searchLabel, envTitle }: { systems: ContextSystem[]; current: string | null; pick: (id: string | null) => void; allLabel: string; searchLabel: string; envTitle: (c: string) => string }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const rows = systems.filter((x) => !s || `${x.name} ${x.typeLabel}`.toLowerCase().includes(s));
  return (
    <>
      {systems.length > 8 ? <input className="mx-input" aria-label={searchLabel} placeholder={searchLabel} value={q} onChange={(e) => setQ(e.target.value)} autoFocus /> : null}
      <ul role="listbox" aria-label={allLabel} className="mx-ctx-list">
        <li role="option" aria-selected={current === null}><button type="button" className="mx-menuitem" onClick={() => pick(null)}>{allLabel}</button></li>
        {rows.map((x) => (
          <li key={x.id} role="option" aria-selected={x.id === current}>
            <button type="button" className="mx-menuitem mx-ctx-row" onClick={() => pick(x.id)}>
              <span className="mx-ctx-name">{x.name}</span>
              <span className="mx-muted">{x.typeLabel}</span>
              <EnvBadge environment={x.environment} title={envTitle(x.environment ?? "")} />
              {x.lastRun ? <span className="mx-muted">{x.lastRun}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
