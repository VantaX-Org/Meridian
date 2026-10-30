"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { EmptyTab, ObjectFrame, RulesTab } from "./Object";
import { ReadinessTab } from "./object/ReadinessTab";
import { RecordsTab } from "./object/LedgerSlot";
import { RunsTab } from "./object/RunsTab";
import { GoldenTab } from "./object/GoldenTab";
import { GlossaryTab } from "./object/GlossaryTab";
import { LineageTab } from "./object/LineageTab";
import { ProcessesTab } from "./object/ProcessesTab";
import { RuleCanvas } from "./Rule";

interface ObjectParams {
  system: string;
  module: string;
  [key: string]: string | string[];
}

/** The object layout: reads the address, draws the header, ruler, receipt and tabs, and puts the tab below. */
export function ObjectRouteFrame({ children }: { children: ReactNode }) {
  const p = useParams<ObjectParams>();
  return (
    <ObjectFrame system={String(p.system)} module={String(p.module)}>
      {children}
    </ObjectFrame>
  );
}

export function ObjectRulesRoute() {
  const p = useParams<ObjectParams>();
  return <RulesTab system={String(p.system)} module={String(p.module)} />;
}

export function ObjectTabRoute({ tab }: { tab: "records" | "fixes" | "runs" | "readiness" | "processes" | "lineage" | "glossary" | "golden" }) {
  const p = useParams<ObjectParams>();
  const [system, module] = [String(p.system), String(p.module)];
  if (tab === "records") return <RecordsTab system={system} module={module} />;
  if (tab === "runs") return <RunsTab system={system} module={module} />;
  if (tab === "readiness") return <ReadinessTab system={system} module={module} />;
  if (tab === "processes") return <ProcessesTab system={system} module={module} />;
  if (tab === "lineage") return <LineageTab system={system} module={module} />;
  if (tab === "glossary") return <GlossaryTab system={system} module={module} />;
  if (tab === "golden") return <GoldenTab system={system} module={module} />;
  return <EmptyTab tab={tab} system={system} module={module} />;
}

/** /r/{check_id}: the rule canvas. */
export function RuleRoute() {
  const p = useParams<{ id: string }>();
  return <RuleCanvas id={decodeURIComponent(String(p.id))} />;
}
