"use client";

import type { ComponentType, ReactNode } from "react";
import type { OpenItem, OpenKind } from "@/lib/v2/hooks";
import { JobInspector } from "./job";
import { RunInspector } from "./run";
import { SystemInspector } from "./system";

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
};

export function extensionFor(item: OpenItem, onClose: () => void): ReactNode {
  const Body = INSPECTOR_BODIES[item.kind];
  return Body ? <Body key={`${item.kind}:${item.id}`} id={item.id} onClose={onClose} /> : null;
}
