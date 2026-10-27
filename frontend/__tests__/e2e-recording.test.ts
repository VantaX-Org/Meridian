// The recording, corrected to the API's counting rules: the figures the pages read agree with each other.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { correctRecording } from "../e2e/fixtures/recording-corrections";

type Entry = { request: { method: string; url: string }; response: { content: { text?: string; encoding?: string } } };

const har = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "..", "e2e", "fixtures", "api.har.gz"))).toString("utf8")) as { log: { entries: Entry[] } };
correctRecording(har);
const body = <T,>(pathAndQuery: string): T => {
  const e = har.log.entries.find((x) => x.request.method === "GET" && x.request.url.endsWith(`/api/v1${pathAndQuery}`));
  if (!e?.response.content.text) throw new Error(`not recorded: ${pathAndQuery}`);
  const { text, encoding } = e.response.content;
  return JSON.parse(encoding === "base64" ? Buffer.from(text, "base64").toString("utf8") : text) as T;
};

type Agg = { total: number; affected_records: number; version_ids: string[]; severity: Record<string, number>; by_module: { module: string; findings: number; affected: number }[] };
type Objects = { objects: { module: string; failing_checks: number; affected_records: number }[] };

describe("the corrected recording", () => {
  const cleansing = body<{ objects: { module: string; version_id: string }[]; steps: { key: string; records: number }[] }>("/insights/cleansing?scope=current");

  it("counts the current state's failing rules and rule failures as the objects list does, each object once", () => {
    const agg = body<Agg>("/findings/aggregate");
    const rows = cleansing.objects.map((o) => body<Objects>(`/objects?run=${o.version_id}`).objects.find((x) => x.module === o.module)!);
    expect(rows).toHaveLength(15);
    expect(agg.total).toBe(rows.reduce((a, o) => a + o.failing_checks, 0));
    expect(agg.total).toBe(1366);
    expect(agg.affected_records).toBe(rows.reduce((a, o) => a + o.affected_records, 0));
    expect(agg.affected_records).toBe(343176);
    expect(agg.version_ids).not.toContain("65988d5a-0243-4f9b-bdff-52779e71c6ed");
    expect(Object.values(agg.severity).reduce((a, n) => a + n, 0)).toBe(agg.total);
  });

  it("counts one run's failing rules as its objects list does: the system page's 29, never 172", () => {
    const vendor = "65988d5a-0243-4f9b-bdff-52779e71c6ed";
    const agg = body<Agg>(`/findings/aggregate?version_id=${vendor}`);
    const [o] = body<Objects>(`/objects?run=${vendor}`).objects;
    expect([agg.total, agg.affected_records]).toEqual([o.failing_checks, o.affected_records]);
    expect(agg.total).toBe(29);
  });

  it("starts the cleansing funnel from distinct failing records, never more than the rule failures", () => {
    const failing = cleansing.steps.find((s) => s.key === "failing")!.records;
    expect(failing).toBeLessThan(343176);
  });
});
