"use client";

import type { ComponentType } from "react";
import { t } from "@/lib/v2/i18n";
import { AletheiaEvidence } from "@/design/v2/screens/AletheiaEvidence";
import { AletheiaForesight } from "@/design/v2/screens/AletheiaForesight";
import { AletheiaReason } from "@/design/v2/screens/AletheiaReason";
import { AletheiaSurvivorship } from "@/design/v2/screens/AletheiaSurvivorship";
import { MdmHealth } from "@/design/v2/screens/MdmHealth";
import { EntryGate } from "@/design/v2/screens/EntryGate";
import { ReferenceData } from "@/design/v2/screens/ReferenceData";
import { Links } from "@/design/v2/screens/Links";
import { Catalogue } from "@/design/v2/screens/Catalogue";
import { Issues } from "@/design/v2/screens/Issues";
import { Mining } from "@/design/v2/screens/Mining";
import { ProcessDiscovery } from "@/design/v2/screens/ProcessDiscovery";
import { ScoreLens } from "@/design/v2/screens/ScoreLens";
import { Insights } from "@/design/v2/screens/Insights";
import { Forecast } from "@/design/v2/screens/Forecast";
import { Value } from "@/design/v2/screens/Value";
import { Config } from "@/design/v2/screens/Config";
import { RunsCanvas } from "@/design/v2/screens/Runs";
import { Atlas } from "@/design/v2/screens/Atlas";

export interface Tab { id: string; label: () => string; Screen: ComponentType }
export interface Group { id: string; title: () => string; blurb: () => string; tabs: Tab[] }

/** Tabbed groups: ?tab= picks the screen, the first tab is the default. Every screen is the existing v2 one. */
export const GROUPS: Group[] = [
  { id: "aletheia", title: () => t("Aletheia"), blurb: () => t("The reasoning engine, with its evidence."), tabs: [
    { id: "evidence", label: () => t("Evidence"), Screen: AletheiaEvidence },
    { id: "foresight", label: () => t("Foresight"), Screen: AletheiaForesight },
    { id: "reason", label: () => t("Reason"), Screen: AletheiaReason },
    { id: "survivorship", label: () => t("Survivorship"), Screen: AletheiaSurvivorship },
  ] },
  { id: "master-data", title: () => t("Master data"), blurb: () => t("Golden records, gates, links and reference data."), tabs: [
    { id: "golden", label: () => t("Golden records"), Screen: MdmHealth },
    { id: "entry-gate", label: () => t("Entry gate"), Screen: EntryGate },
    { id: "reference", label: () => t("Reference data"), Screen: ReferenceData },
    { id: "links", label: () => t("Links"), Screen: Links },
    { id: "catalogue", label: () => t("Catalogue"), Screen: Catalogue },
    { id: "issues", label: () => t("Issues"), Screen: Issues },
    { id: "mining", label: () => t("Mining"), Screen: Mining },
    { id: "processes", label: () => t("Processes"), Screen: ProcessDiscovery },
  ] },
  { id: "insights", title: () => t("Insights"), blurb: () => t("Score, forecast and value."), tabs: [
    { id: "score", label: () => t("Score"), Screen: ScoreLens },
    { id: "insights", label: () => t("Insights"), Screen: Insights },
    { id: "forecast", label: () => t("Forecast"), Screen: Forecast },
    { id: "value", label: () => t("Value"), Screen: Value },
  ] },
];

/** Single screens, addressed by their path under /more. */
export const SINGLES: Record<string, { title: () => string; blurb: () => string; Screen: ComponentType }> = {
  runs: { title: () => t("Runs"), blurb: () => t("Every run, across every system."), Screen: RunsCanvas },
  "systems/config": { title: () => t("Configuration"), blurb: () => t("Thresholds and settings."), Screen: Config },
  atlas: { title: () => t("Atlas"), blurb: () => t("The landscape and its flows."), Screen: Atlas },
};

/** Screens that stay at their own address; More links to them so nothing is lost. */
export const LINKS: Array<{ href: string; title: () => string; blurb: () => string }> = [
  { href: "/migration", title: () => t("Migration"), blurb: () => t("Plan and track the move to the new system.") },
  { href: "/s4", title: () => t("S/4 readiness"), blurb: () => t("How ready each object is for S/4HANA.") },
  { href: "/go-live", title: () => t("Go-live"), blurb: () => t("The flight deck for cutover.") },
  { href: "/system-compare", title: () => t("Compare systems"), blurb: () => t("Two systems, side by side.") },
  { href: "/status", title: () => t("Status"), blurb: () => t("Service health and recent incidents.") },
];

/** The More home: one text tile each. Native screens first, then the groups, then the screens that keep their own address. */
export interface Tile { id: string; href: string; title: () => string; blurb: () => string; adminOnly?: boolean }
export const TILES: Tile[] = [
  { id: "rules", href: "/more/rules", title: () => t("Rules"), blurb: () => t("The checks every object is scored against.") },
  { id: "reports", href: "/more/reports", title: () => t("Reports"), blurb: () => t("Files, schedules and shared links.") },
  { id: "systems", href: "/more/systems", title: () => t("Systems"), blurb: () => t("The connected systems, and how to connect one.") },
  { id: "people", href: "/more/people", title: () => t("People"), blurb: () => t("Who holds the open work.") },
  { id: "admin", href: "/more/admin", title: () => t("Administration"), blurb: () => t("Users, roles, licence and settings."), adminOnly: true },
  ...GROUPS.map((g) => ({ id: g.id, href: `/more/${g.id}`, title: g.title, blurb: g.blurb })),
  ...Object.entries(SINGLES).filter(([k]) => !k.includes("/")).map(([k, s]) => ({ id: k, href: `/more/${k}`, title: s.title, blurb: s.blurb })),
  ...LINKS.map((l) => ({ id: l.href, href: l.href, title: l.title, blurb: l.blurb })),
];
