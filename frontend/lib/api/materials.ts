import apiClient from "./client";

/** Mirrors api/routes/materials.py. Fields are SAP field names; the page names them TABLE.FIELD. */
export type CellState = "ok" | "missing" | "na" | "none";

export interface MaterialLevel { id: string; kind: string; plant: string | null }
export interface ViewCell { level: string; state: CellState }
export interface ViewCompleteness { view: string; label: string; expected: boolean | null; cells: ViewCell[] }

type Row = Record<string, string | null>;

export interface Material360 {
  matnr: string;
  description: string | null;
  language: string | null;
  mara: Row;
  makt: Row[]; marm: Row[]; mean: Row[]; marc: Row[]; mvke: Row[]; mbew: Row[]; mard: Row[]; mlgn: Row[];
  /** material_master: MTART/MATKL/MEINS. business_partner: PARTNER/BU_TYPE/NAME1/NAME_ORG1. */
  labels: Row;
  expected_views: string[] | null;
  expected_known: boolean;
  levels: MaterialLevel[];
  levels_total: number;
  views: ViewCompleteness[];
  phasing: {
    plants: number; phasing_out: number; with_followup: number;
    plant: string | null; ausdt: string | null; nfmat: string | null; followup_description: string | null;
  };
  version_id: string;
}

export interface FailingRule {
  check_id: string; message: string; severity: string; field: string | null; level: string;
  actual_value: string | null; record_key: string; issue_id: string | null; issue_status: string | null;
  record_fix: string | null;
}
export interface ViewFindings {
  view: string; label: string; rules: number; failing: FailingRule[]; passing_count: number; not_evaluated: string[];
}
export interface MaterialFindings { matnr: string; version_id: string; rules_total: number; by_view: ViewFindings[] }

export interface ChainNode {
  matnr: string; maktx: string | null; this: boolean; dismm: string | null; mmsta: string | null;
  kzaus: string | null; ausdt: string | null; nfmat: string | null; flags: string[];
}
export interface SupersessionChain {
  werks: string; kzaus: string | null; ausdt: string | null; chain: ChainNode[]; links: number;
  loop_at: string | null; dead_end: boolean; truncated: boolean; depth: number;
}
export interface BomUse { stlnr: string | null; posnr: string | null; werks: string | null; nfeag: string | null; nfgrp: string | null; flags: string[] }
export interface MaterialSupersession { matnr: string; plants: SupersessionChain[]; bom_usage: BomUse[] | null }

export interface DuplicateCandidate {
  matnr: string; maktx: string | null; mtart: string | null; matkl: string | null; meins: string | null;
  ean11: string | null; matches_on: string[]; score: number;
}
export interface MaterialDuplicates { matnr: string; algorithm: string; threshold: number; source: string; items: DuplicateCandidate[] }

const url = (matnr: string, sub = "") => `/api/v1/materials/${encodeURIComponent(matnr)}${sub}`;
const get = async <T>(path: string, params?: Record<string, string | undefined>) => (await apiClient.get<T>(path, { params })).data;

export const getMaterial = (matnr: string, p: { version_id?: string; plant?: string } = {}) => get<Material360>(url(matnr), p);
export const getMaterialFindings = (matnr: string, p: { version_id?: string } = {}) => get<MaterialFindings>(url(matnr, "/findings"), p);
export const getMaterialSupersession = (matnr: string, p: { version_id?: string; plant?: string } = {}) =>
  get<MaterialSupersession>(url(matnr, "/supersession"), p);
export const getMaterialDuplicates = (matnr: string, p: { version_id?: string } = {}) => get<MaterialDuplicates>(url(matnr, "/duplicates"), p);
