import { describe, expect, it } from "vitest";
import type { Job } from "@/types/jobs";
import { openFailures } from "./jobs";

const job = (id: string, status: Job["status"], started_at: number, finished_at: number | null): Job =>
  ({ id, kind: "extraction", status, label: "", modules: [], started_at, finished_at, system_id: "s1" }) as unknown as Job;

describe("openFailures", () => {
  it("keeps a failure nothing has replaced", () => {
    expect(openFailures([job("f", "failed", 100, 200)]).map((j) => j.id)).toEqual(["f"]);
  });
  it("drops a failure a later retry is still running for", () => {
    expect(openFailures([job("f", "failed", 100, 200), job("r", "running", 300, null)])).toEqual([]);
  });
  it("drops a failure a later queued retry will redo", () => {
    expect(openFailures([job("f", "failed", 100, 200), job("q", "queued", 300, null)])).toEqual([]);
  });
  it("keeps a failure when the running job started before it", () => {
    expect(openFailures([job("f", "failed", 100, 200), job("r", "running", 50, null)]).map((j) => j.id)).toEqual(["f"]);
  });
  it("drops a failure a later success replaced", () => {
    expect(openFailures([job("f", "failed", 100, 200), job("c", "completed", 250, 400)])).toEqual([]);
  });
});
