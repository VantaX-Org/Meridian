/**
 * Material 360 client: one material across every view and organisational level (api/routes/materials.py).
 *
 *   GET /materials/{matnr}?version_id=&plant=       (the record, its labels and the views x levels matrix)
 *   GET /materials/{matnr}/findings?version_id=     (failing rules per view)
 *   GET /materials/{matnr}/supersession?plant=      (follow-up chain per plant and BOM usage)
 *   GET /materials/{matnr}/duplicates               (other materials that look like this one)
 *
 * Each answers 404 when the material is not in MARA and 409 when no run has a dataset.
 */
import { v2Get } from "./client";

export type CellState = "ok" | "missing" | "na" | "none";

export interface MaterialLevel {
  id: string;
  kind: "client" | "plant" | "sales" | "valuation" | "sloc" | "warehouse";
  plant?: string | null;
}

export interface MaterialView {
  view: string;
  label: string;
  expected: boolean | null;
  cells: { level: string; state: CellState }[];
}

export interface Material360 {
  matnr: string;
  description: string | null;
  language: string | null;
  mara: Record<string, unknown>;
  marc: Record<string, unknown>[];
  mbew: Record<string, unknown>[];
  mvke: Record<string, unknown>[];
  mard: Record<string, unknown>[];
  labels: Record<string, string | null>;
  expected_known: boolean;
  levels: MaterialLevel[];
  levels_total: number;
  views: MaterialView[];
  phasing: { plants: number; phasing_out: number; with_followup: number; plant?: string | null; ausdt?: string | null; nfmat?: string | null; followup_description?: string | null };
  version_id: string | null;
}

export interface FailingRule {
  check_id: string;
  message: string | null;
  severity: string;
  field?: string | null;
  level: string;
  actual_value?: string | null;
  record_key: string;
  issue_id?: string | null;
  issue_status?: string | null;
}

export interface MaterialFindings {
  matnr: string;
  version_id: string | null;
  rules_total: number;
  by_view: { view: string; label: string; rules: number; failing: FailingRule[]; passing_count: number; not_evaluated: string[] }[];
}

export interface ChainNode {
  matnr: string;
  maktx?: string | null;
  this: boolean;
  dismm?: string | null;
  mmsta?: string | null;
  kzaus?: string | null;
  ausdt?: string | null;
  nfmat?: string | null;
  flags: string[];
}

export interface Supersession {
  matnr: string;
  plants: { werks: string; kzaus?: string | null; ausdt?: string | null; chain: ChainNode[]; links: number; loop_at?: string | null; dead_end: boolean; truncated: boolean; depth: number }[];
  bom_usage: { stlnr?: string | null; posnr?: string | null; werks?: string | null; nfeag?: string | null; nfgrp?: string | null; flags: string[] }[] | null;
}

export interface Duplicates {
  matnr: string;
  algorithm: string;
  threshold: number;
  source: string;
  items: { matnr: string; maktx?: string | null; mtart?: string | null; matkl?: string | null; meins?: string | null; ean11?: string | null; matches_on: string[]; score: number }[];
}

const path = (m: string, tail = "") => `/materials/${encodeURIComponent(m)}${tail}`;

export const getMaterial = (m: string) => v2Get<Material360>(path(m));
export const getMaterialFindings = (m: string) => v2Get<MaterialFindings>(path(m, "/findings"));
export const getSupersession = (m: string) => v2Get<Supersession>(path(m, "/supersession"));
export const getDuplicates = (m: string) => v2Get<Duplicates>(path(m, "/duplicates"));
