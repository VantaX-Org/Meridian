"use client";

import type { ComponentType, ReactNode } from "react";
import type { OpenItem, OpenKind } from "@/lib/v2/hooks";
import { BatchInspector } from "./batch";
import { InboxPanel } from "./inbox";
import { JobInspector } from "./job";
import { PersonInspector } from "./person";
import { RunInspector } from "./run";
import { SystemInspector } from "./system";
import { TriagePanel } from "./triage";

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
};

export function extensionFor(item: OpenItem, onClose: () => void): ReactNode {
  const Body = INSPECTOR_BODIES[item.kind];
  return Body ? <Body key={`${item.kind}:${item.id}`} id={item.id} onClose={onClose} /> : null;
}
