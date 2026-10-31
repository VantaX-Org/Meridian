/**
 * Record links client: which records are linked across objects, as relationship discovery found them in SAP's link
 * tables (KNA1, LFA1, MARC and the rest) or inferred them (api/routes/relationships.py, both need view).
 *
 *   GET /relationships?domain=&key=&include_inactive=   (the latest 200 links, newest first, with the full count)
 *   GET /relationship-types                             (the link types every tenant shares)
 *
 * With an object and a key the route answers the links of that one record in both directions. The AI confidence and
 * impact score come back as null for roles that may not see AI confidence.
 */
import { v2Get } from "./client";

export interface RecordLink {
  id: string;
  from_domain: string;
  from_key: string;
  to_domain: string;
  to_key: string;
  relationship_type: string;
  sap_link_table: string | null;
  discovered_at: string;
  active: boolean;
  ai_inferred: boolean;
  ai_confidence: number | null;
  impact_score: number | null;
}

export interface LinkType {
  id: string;
  from_table: string;
  to_table: string;
  relationship_type: string;
  description: string | null;
}

/** The route returns at most this many links per answer. */
export const LINK_LIMIT = 200;

export const getLinks = (q: { domain?: string; key?: string; include_inactive?: boolean }) =>
  v2Get<{ relationships: RecordLink[]; total: number }>("/relationships", {
    ...(q.domain ? { domain: q.domain } : {}),
    ...(q.domain && q.key ? { key: q.key } : {}),
    ...(q.include_inactive ? { include_inactive: true } : {}),
  });

export const getLinkTypes = () => v2Get<LinkType[]>("/relationship-types");
