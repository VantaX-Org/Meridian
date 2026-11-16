"use client";

import type { ComponentType } from "react";
import { OpsEngine } from "./ops-engine";
import { OpsPlatform } from "./ops-platform";
import { OpsRuns } from "./ops-runs";
import { OpsSchedules } from "./ops-schedules";
import { OpsSystems } from "./ops-systems";
import { OpsWorkflows } from "./ops-workflows";
import "./ops.css";

/** Admin ops group: start and schedule runs, systems, platform, the engine and workflows. */
export const OPS_SECTIONS: Record<string, ComponentType> = {
  runs: OpsRuns,
  runschedules: OpsSchedules,
  systems: OpsSystems,
  system: OpsPlatform,
  aletheia: OpsEngine,
  workflows: OpsWorkflows,
};
