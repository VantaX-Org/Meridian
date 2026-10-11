import { describe, expect, it } from "vitest";
import { downloadPollMs, type DownloadProgress } from "../system-objects";

const dl = (status: DownloadProgress["status"], job_id: string, started_at = "2026-01-01T10:00:00Z"): DownloadProgress => ({
  status, started_at, job_id, label: null, objects: [],
});

describe("downloadPollMs", () => {
  it("polls while a download is queued or running", () => {
    expect(downloadPollMs(dl("queued", "dl-1"), null)).toBe(4000);
    expect(downloadPollMs(dl("running", "dl-1"), null)).toBe(4000);
  });

  it("stops on a terminal status when nothing was just started", () => {
    expect(downloadPollMs(dl("complete", "dl-1"), null)).toBe(false);
    expect(downloadPollMs(dl("failed", "dl-1"), null)).toBe(false);
    expect(downloadPollMs(null, null)).toBe(false);
  });

  it("keeps polling after a start until the awaited job reports a terminal status", () => {
    expect(downloadPollMs(null, "dl-2")).toBe(4000); // worker has not published progress yet
    expect(downloadPollMs(dl("complete", "dl-1"), "dl-2")).toBe(4000); // stale finished one
    expect(downloadPollMs(dl("complete", "dl-2"), "dl-2")).toBe(false);
    expect(downloadPollMs(dl("failed", "dl-2"), "dl-2")).toBe(false);
  });

  it("ignores started_at, whatever its format or the client clock", () => {
    for (const started_at of ["1767261600.5", "not a date", "2999-01-01T00:00:00Z", "1970-01-01T00:00:00Z"]) {
      expect(downloadPollMs(dl("complete", "dl-2", started_at), "dl-2")).toBe(false);
      expect(downloadPollMs(dl("complete", "dl-1", started_at), "dl-2")).toBe(4000);
    }
  });
});
