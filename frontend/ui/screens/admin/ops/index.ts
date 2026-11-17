import type { ComponentType } from "react";
import { Access } from "./Access";
import { Audit } from "./Audit";
import { Billing } from "./Billing";
import { ContactVerify } from "./ContactVerify";
import { Data } from "./Data";
import { Engine } from "./Engine";
import { Enterprise } from "./Enterprise";
import { ExternalDb } from "./ExternalDb";
import { Mappings } from "./Mappings";
import { Schedules } from "./Schedules";
import { SubjectRequests } from "./SubjectRequests";
import { System } from "./System";
import { Triage } from "./Triage";

/** Admin ops sections by URL slug. Batch 11a spreads this into its section map. */
export const OPS_SECTIONS: Record<string, ComponentType> = {
  data: Data, mappings: Mappings, audit: Audit, system: System, enterprise: Enterprise,
  "subject-requests": SubjectRequests, "contact-verify": ContactVerify, "external-db": ExternalDb,
  triage: Triage, access: Access, engine: Engine, schedules: Schedules, billing: Billing,
};
