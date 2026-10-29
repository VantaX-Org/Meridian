"use client";

import type { ComponentType, ReactNode } from "react";
import type { OpenItem, OpenKind } from "@/lib/v2/hooks";
import { BatchInspector } from "./batch";
import { InboxPanel } from "./inbox";
import { JobInspector } from "./job";
import { PersonInspector } from "./person";
import { PreferencesPanel, HelpPanel } from "./panels";
import { ApiKeyInspector, RoleInspector, UserInspector } from "./people";
import { AuditInspector, ChannelInspector, MappingInspector } from "./records";
import { ReportInspector, ScheduleInspector } from "./reports";
import { WavesPanel } from "./waves";
import { RunInspector } from "./run";
import { SystemInspector } from "./system";
import { TriagePanel } from "./triage";
import { GoldenInspector } from "./golden";
import { TermInspector } from "./term";
import { FeatureInspector } from "./feature";
import { StepInspector } from "./step";
import { ConnectionInspector } from "./connection";
import { ConfigInspector } from "./config";
import { ScheduleInspector as SyncScheduleInspector } from "./schedule";
import { ZObjectInspector } from "./zobject";
import { SurvivorshipInspector } from "./survivorship";
import { BalancePanel } from "./balance";
import { ContractInspector, ContractsPanel } from "./contract";
import { OutOfOfficePanel } from "./delegation";

interface BodyProps {
  id: string;
  onClose: () => void;
}

/**
 * The inspector kinds whose body lives in its own file: `?open=<kind>:<id>` picks the component here. Each draws its
 * own frame (title, status line, body). Kinds not listed fall through to Inspector.tsx.
 */
export const INSPECTOR_BODIES: Partial<Record<OpenKind, ComponentType<BodyProps>>> = {
  run: RunInspector,
  system: SystemInspector,
  job: JobInspector,
  batch: BatchInspector,
  person: PersonInspector,
  inbox: InboxPanel,
  triage: TriagePanel,
  golden: GoldenInspector,
  term: TermInspector,
  feature: FeatureInspector,
  step: StepInspector,
  user: UserInspector,
  role: RoleInspector,
  apikey: ApiKeyInspector,
  audit: AuditInspector,
  channel: ChannelInspector,
  mapping: MappingInspector,
  report: ReportInspector,
  schedule: ScheduleInspector,
  preferences: PreferencesPanel,
  help: HelpPanel,
  waves: WavesPanel,
  connection: ConnectionInspector,
  config: ConfigInspector,
  syncschedule: SyncScheduleInspector,
  zobject: ZObjectInspector,
  survivorship: SurvivorshipInspector,
  contract: ContractInspector,
  contracts: ContractsPanel,
  balance: BalancePanel,
  away: OutOfOfficePanel,
};

export function extensionFor(item: OpenItem, onClose: () => void): ReactNode {
  const Body = INSPECTOR_BODIES[item.kind];
  return Body ? <Body key={`${item.kind}:${item.id}`} id={item.id} onClose={onClose} /> : null;
}
