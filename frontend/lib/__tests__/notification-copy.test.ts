import { describe, expect, it } from "vitest";
import type { Notification } from "@/types/api";
import { collapseNotifications, digestLine, notificationLines, notificationTarget, notificationTitle } from "../notification-copy";
import { jobName } from "../run-scope";

const note = (over: Partial<Notification> = {}): Notification => ({
  id: "n1", tenant_id: "t", user_id: null, type: "finding", title: "t", body: "b", link: null, is_read: false, created_at: "2026-10-16T05:17:00Z", ...over,
});

describe("notification copy", () => {
  it("renders a digest line as a sentence with a link", () => {
    const line = digestLine("Next: Clean: hcm — 57 (low, 1 records)");
    expect(line.text).toBe("Next step: Clean HCM personnel administration record 57, low priority, 1 record.");
    expect(line.text).not.toMatch(/\(low/);
    expect(line.href).toBe("/fix");
    expect(digestLine("0 new findings, 3 cleaning items, 1 exceptions").text).toBe("Since the last digest: 0 new rule failures, 3 cleaning items and 1 exception.");
  });

  it("writes objects, not module(s) or lowercase ids", () => {
    const [line] = notificationLines(note({ body: "Analysis run finished with 172 findings across 1 module(s)." }));
    expect(line.text).toContain("across 1 object.");
    expect(notificationTitle(note({ title: "17 cleaning items need review" }))).toBe("17 cleaning items need review");
    expect(notificationLines(note({ body: "Cleaning detection found 17 candidates for controlling." }))[0].text).toBe("Cleaning detection found 17 candidates for Controlling.");
  });

  it("turns a quality alert into sentences", () => {
    const n = note({ type: "dq_alert", title: "DQ alert — 2 thresholds crossed", body: "2 critical checks failing (threshold 1)\n15 high checks failing (threshold 10)" });
    expect(notificationTitle(n)).toBe("2 quality limits were crossed");
    expect(notificationLines(n).map((l) => l.text)).toEqual([
      "2 critical rules are failing, over your limit of 1.",
      "15 high rules are failing, over your limit of 10.",
    ]);
  });

  it("opens the thing a notification is about: its link, else the page of its type", () => {
    expect(notificationTarget(note({ link: "/findings?version_id=v1" }))).toBe("/findings?version_id=v1");
    expect(notificationTarget(note({ link: "https://evil.example", type: "report" }))).toBe("/insights/reports");
    expect(notificationTarget(note({ type: "daily_digest" }))).toBe("/inbox");
    expect(notificationTarget(note({ type: "info" }))).toBeNull();
  });

  it("collapses exact duplicates from one run into one entry with a count", () => {
    const a = note({ id: "a" });
    const b = note({ id: "b", created_at: "2026-10-16T05:18:00Z", is_read: true });
    const other = note({ id: "c", title: "other" });
    const later = note({ id: "d", created_at: "2026-10-17T05:17:00Z" });
    const groups = collapseNotifications([a, b, other, later]);
    expect(groups.map((g) => [g.n.id, g.count])).toEqual([["a", 2], ["c", 1], ["d", 1]]);
    expect(groups[0].ids).toEqual(["a", "b"]);
  });
});

describe("jobName", () => {
  it("names jobs in words", () => {
    expect(jobName("Re-analysis | material_master_25k")).toBe("Re-analysis of Material master");
    expect(jobName("controlling_1k.csv")).toBe("Upload of Controlling");
    expect(jobName("Extract vendors")).toBe("Extract vendors");
  });
});
