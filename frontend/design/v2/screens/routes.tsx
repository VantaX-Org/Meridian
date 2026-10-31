"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { EmptyTab, ObjectFrame, RulesTab } from "./Object";
import { Skeleton } from "../parts";

/** A tab loads with its own address, not with every object page: until it arrives its place shows the skeleton of a table. */
function TabLoading() {
  return (
    <div className="m2-sec" aria-busy="true">
      <Skeleton width="40%" height={16} />
      <div className="m2-frame m2-tab-wait">
        <Skeleton width="100%" height={14} />
        <Skeleton width="92%" height={14} />
        <Skeleton width="84%" height={14} />
      </div>
    </div>
  );
}
type TabProps = { system: string; module: string };
const ReadinessTab = dynamic<TabProps>(() => import("./object/ReadinessTab").then((m) => m.ReadinessTab), { loading: TabLoading });
const RecordsTab = dynamic<TabProps>(() => import("./object/LedgerSlot").then((m) => m.RecordsTab), { loading: TabLoading });
const RunsTab = dynamic<TabProps>(() => import("./object/RunsTab").then((m) => m.RunsTab), { loading: TabLoading });
const GoldenTab = dynamic<TabProps>(() => import("./object/GoldenTab").then((m) => m.GoldenTab), { loading: TabLoading });
const GlossaryTab = dynamic<TabProps>(() => import("./object/GlossaryTab").then((m) => m.GlossaryTab), { loading: TabLoading });
const LineageTab = dynamic<TabProps>(() => import("./object/LineageTab").then((m) => m.LineageTab), { loading: TabLoading });
const ProcessesTab = dynamic<TabProps>(() => import("./object/ProcessesTab").then((m) => m.ProcessesTab), { loading: TabLoading });
const RecordCanvas = dynamic<{ module: string; recordKey: string }>(() => import("./RecordCanvas").then((m) => m.RecordCanvas), { loading: TabLoading });
const RuleCanvas = dynamic<{ id: string }>(() => import("./Rule").then((m) => m.RuleCanvas), { loading: TabLoading });

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

/** /o/{system}/{module}/records/{key}: one record on the canvas. */
export function ObjectRecordRoute() {
  const p = useParams<ObjectParams & { key: string }>();
  return <RecordCanvas module={String(p.module)} recordKey={String(p.key)} />;
}

/** /r/{check_id}: the rule canvas. */
export function RuleRoute() {
  const p = useParams<{ id: string }>();
  return <RuleCanvas id={decodeURIComponent(String(p.id))} />;
}
