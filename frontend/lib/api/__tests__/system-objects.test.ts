import { describe, expect, it } from "vitest";
import { downloadPollMs, type DownloadProgress } from "../system-objects";

const dl = (status: DownloadProgress["status"], started_at: string): DownloadProgress => ({
  status, started_at, job_id: "dl-1", label: null, objects: [],
});
const T = Date.parse("2026-01-01T10:00:00Z");

describe("downloadPollMs", () => {
  it("polls while a download is queued or running", () => {
    expect(downloadPollMs(dl("queued", "2026-01-01T10:00:00Z"), null)).toBe(4000);
    expect(downloadPollMs(dl("running", "2026-01-01T10:00:00Z"), null)).toBe(4000);
  });

  it("stops on a terminal status when nothing was just started", () => {
    expect(downloadPollMs(dl("complete", "2026-01-01T09:00:00Z"), null)).toBe(false);
    expect(downloadPollMs(dl("failed", "2026-01-01T09:00:00Z"), null)).toBe(false);
    expect(downloadPollMs(null, null)).toBe(false);
  });

  it("keeps polling after a start until a newer download reports", () => {
    expect(downloadPollMs(null, T)).toBe(4000); // worker has not published progress yet
    expect(downloadPollMs(dl("complete", "2026-01-01T09:00:00Z"), T)).toBe(4000); // stale finished one
    expect(downloadPollMs(dl("complete", "2026-01-01T10:00:05Z"), T)).toBe(false);
    expect(downloadPollMs(dl("failed", "2026-01-01T10:00:05Z"), T)).toBe(false);
  });
});
