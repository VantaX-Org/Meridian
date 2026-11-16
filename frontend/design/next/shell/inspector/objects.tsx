"use client";

import type React from "react";
import type { BodyProps } from "./frame";
import { ConfigInspector, ConnectionInspector, ScheduleInspector } from "./objects-connection";
import { GoldenInspector, SurvivorshipInspector } from "./objects-golden";
import { FeatureInspector, FieldInspector, MappingInspector, TermInspector, ZObjectInspector } from "./objects-meta";
import { SystemInspector } from "./objects-system";
import "./objects.css";

/** Inspector bodies for the objects group: systems, connections, MDM records and catalogue entries. */
export const OBJECTS_BODIES: Record<string, React.ComponentType<BodyProps>> = {
  system: SystemInspector,
  connection: ConnectionInspector,
  config: ConfigInspector,
  syncschedule: ScheduleInspector,
  zobject: ZObjectInspector,
  golden: GoldenInspector,
  survivorship: SurvivorshipInspector,
  field: FieldInspector,
  term: TermInspector,
  feature: FeatureInspector,
  mapping: MappingInspector,
};
