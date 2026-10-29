"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { EmptyFrame, PageTitle, V2Link } from "../parts";
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

/** /v2/r/{check_id}: the rule canvas. */
export function RuleRoute() {
  const p = useParams<{ id: string }>();
  return <RuleCanvas id={decodeURIComponent(String(p.id))} />;
}

const NOT_YET: Record<string, { title: string; text: string; action: string; href: string }> = {
  work: {
    title: "Work",
    text: "The ledger of every record and failing field, ranked by value at risk, arrives in the next step. Until then, fix work stays in the current interface.",
    action: "Open fix work",
    href: "/fix",
  },
  runs: {
    title: "Runs",
    text: "Run history and run compare arrive in the next step. The run menu in the top bar already switches the numbers on every canvas.",
    action: "Open the runs",
    href: "/runs",
  },
  people: {
    title: "People",
    text: "Owners and stewards with their open work and approvals waiting arrive in the next step.",
    action: "Open the inbox",
    href: "/inbox",
  },
  rule: {
    title: "Rule",
    text: "One rule across systems, with its definition, failing records and the features it blocks, arrives in the next step. The inspector already shows what is known.",
    action: "Open rules",
    href: "/rules",
  },
  run: {
    title: "Run",
    text: "What changed in a run, by rule and by object, with the reason the score moved, arrives in the next step.",
    action: "Open the runs",
    href: "/runs",
  },
};

/** A canvas that does not exist yet in step 0: an honest frame with one way on into the current interface. */
export function NotYetCanvas({ kind }: { kind: keyof typeof NOT_YET }) {
  const def = NOT_YET[kind];
  return (
    <>
      <PageTitle>{def.title}</PageTitle>
      <div className="m2-sec">
        <EmptyFrame
          action={
            <V2Link href={def.href} className="m2-btn">
              {def.action}
            </V2Link>
          }
        >
          {def.text}
        </EmptyFrame>
      </div>
    </>
  );
}
