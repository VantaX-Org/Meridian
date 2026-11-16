"use client";

/** Registers the J6 and J10 journey sheet kinds: contracts, contract, digests, following, field-mappings, dedup. Imported by shell/sheets.ts. */
import { registerSheet } from "../shell/registry";
import { ContractSheet, ContractsSheet } from "./Contracts";
import { DedupSheet } from "./Dedup";
import { DigestsSheet } from "./Digests";
import { FieldMappingsSheet } from "./FieldMappings";
import { FollowingSheet } from "./Following";

export function registerJourney() {
  registerSheet("contracts", (ctx) => <ContractsSheet ctx={ctx} />);
  registerSheet("contract", (ctx) => <ContractSheet ctx={ctx} />);
  registerSheet("digests", (ctx) => <DigestsSheet ctx={ctx} />);
  registerSheet("following", (ctx) => <FollowingSheet ctx={ctx} />);
  registerSheet("field-mappings", (ctx) => <FieldMappingsSheet ctx={ctx} />);
  registerSheet("dedup", (ctx) => <DedupSheet ctx={ctx} />);
}
registerJourney();
