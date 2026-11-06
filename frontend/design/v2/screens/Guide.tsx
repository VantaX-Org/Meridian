"use client";

import type { ReactNode } from "react";
import { InactiveChip, Lede, PrimaryAction } from "../RunParts";
import { t } from "@/lib/v2/i18n";
import "./stage6.css";

/** Names the system a page speaks about; a page that belongs to no one system leaves it out. */
export function SystemChip({ name, inactive }: { name: string; inactive?: boolean }) {
  return (
    <span className="m2-guide-head" data-testid="system-chip">
      <span className="m2-syschip">{name}</span>
      {inactive ? <InactiveChip /> : null}
    </span>
  );
}

/**
 * The top of a screen for a new reader: what it shows, the one next action (the only filled button, passed in), and
 * what each figure means. `means` pairs a figure's name with its definition.
 */
export function Guide({ shows, action, why, means, system, inactive, extra }: { shows: ReactNode; action?: ReactNode; why?: ReactNode; means?: readonly (readonly [string, string])[]; system?: string | null; inactive?: boolean; extra?: ReactNode }) {
  return (
    <div className="m2-guide" data-testid="guide">
      {system || extra ? (
        <div className="m2-guide-head">
          {system ? <SystemChip name={system} inactive={inactive} /> : null}
          {extra}
        </div>
      ) : null}
      <Lede>{shows}</Lede>
      {action ? <PrimaryAction action={action} why={why} /> : null}
      {means?.length ? (
        <details className="m2-guide-means">
          <summary>{t("What the figures mean")}</summary>
          <dl>
            {means.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
