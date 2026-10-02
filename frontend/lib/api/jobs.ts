import apiClient from "./client";
import type { Job, JobListResponse } from "@/types/jobs";

export async function getJobs(params: { active?: boolean; limit?: number } = {}): Promise<Job[]> {
  const res = await apiClient.get<JobListResponse>("/api/v1/jobs", { params });
  return res.data.jobs;
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await apiClient.get<Job>(`/api/v1/jobs/${jobId}`);
  return res.data;
}

/**
 * Live job stream. EventSource cannot send the bearer token, so this reads
 * the SSE body through fetch and parses `event:`/`data:` frames itself.
 * Returns a stop function. Reconnection is the caller's concern.
 */
export function streamJobs(
  onJob: (job: Job) => void,
  onEnd: (error?: unknown) => void,
): () => void {
  const controller = new AbortController();
  const token = typeof window !== "undefined" ? localStorage.getItem("mn_auth_token") : null;
  (async () => {
    try {
      const res = await fetch("/api/v1/jobs/events", {
        headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`jobs stream: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue; // heartbeat comment
          try {
            onJob(JSON.parse(data) as Job);
          } catch {
            /* malformed frame — skip */
          }
        }
      }
      onEnd();
    } catch (err) {
      if (!controller.signal.aborted) onEnd(err);
    }
  })();
  return () => controller.abort();
}
