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

/** One answer. `ai` is true only when no built-in answer fitted and the model wrote it from aggregated findings. */
export interface AskAnswer {
  answer: string;
  intent: AskIntent | string;
  data: AskDatum[] | null;
  chart: "bar" | "line" | null;
  links: AskLink[];
  ai: boolean;
  version_id: string | null;
}

/** Ask Meridian a question about the tenant's data quality. */
export async function askMeridian(body: AskRequest): Promise<AskAnswer> {
  const { data } = await apiClient.post<AskAnswer>("/api/v1/assistant/ask", body, { requestAccess: false });
  return data;
}
