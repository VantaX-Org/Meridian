import apiClient from "./client";

/** POST /api/v1/assistant/ask body. `version_id` is the run the page shows; without it the latest finished run is used. */
export interface AskRequest {
  question: string;
  version_id?: string;
  module?: string;
}

export type AskIntent =
  | "help"
  | "score"
  | "weakest_objects"
  | "top_rules"
  | "critical"
  | "readiness"
  | "root_causes"
  | "fixes"
  | "owners"
  | "changes"
  | "rule"
  | "value_at_risk"
  | "forecast"
  | "progress"
  | "retrieval"
  | "refused"
  | "ai"
  | "unknown";

export interface AskDatum {
  label: string;
  value: number;
}

export interface AskLink {
  label: string;
  /** A relative app route that opens the page behind the answer. */
  href: string;
}

/** One figure an answer was assembled from, in the order the answer uses them. */
export interface AskFact {
  statement: string;
  value: number | null;
  /** Where the figure comes from, in words ("Run of 25 Oct, Material master score", "Rule ranking"). */
  source: string;
  /** A relative app route that opens the page behind the figure. */
  href: string | null;
}

/**
 * One answer. Every number in `answer` appears in `facts` when `grounded` is true (the server checks it).
 * `phrased` is true when the model reworded the assembled facts without adding a number; `ai` equals `phrased`.
 * `coverage` (0..1) is how much of the question the facts cover: 1 in full, below 1 for a partial retrieval, 0 when refused.
 */
export interface AskAnswer {
  answer: string;
  intent: AskIntent | string;
  data: AskDatum[] | null;
  chart: "bar" | "line" | null;
  links: AskLink[];
  facts: AskFact[];
  coverage: number;
  grounded: boolean;
  phrased: boolean;
  ai: boolean;
  version_id: string | null;
}

/** Ask Meridian a question about the tenant's data quality. */
export async function askMeridian(body: AskRequest): Promise<AskAnswer> {
  const { data } = await apiClient.post<AskAnswer>("/api/v1/assistant/ask", body, { requestAccess: false });
  return data;
}
