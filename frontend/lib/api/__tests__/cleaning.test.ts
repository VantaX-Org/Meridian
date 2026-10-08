import { describe, expect, it } from "vitest";
import { groupIntoBatches, type CleaningQueueItem } from "../cleaning";

const item = (over: Partial<CleaningQueueItem>): CleaningQueueItem => ({
  id: "1", object_type: "material_master", status: "recommended", confidence: 0.9,
  record_key: "100001", priority: 1, detected_at: "", applied_at: null,
  rollback_deadline: null, rule_id: null, batch_id: "B1", version_id: null,
  merge_preview: null, record_data_before: null, record_data_after: null,
  golden_record_id: null, golden_field_value: null, golden_record_exists: false,
  ...over,
});

describe("groupIntoBatches", () => {
  it("groups by batch_id and averages confidence", () => {
    const rows = groupIntoBatches([item({ confidence: 0.8 }), item({ confidence: 1.0 })]);
    expect(rows).toEqual([{ batch_id: "B1", object_type: "material_master", items: 2, avg_confidence: 0.9, status: "recommended" }]);
  });
  it("marks status mixed when items disagree", () => {
    const rows = groupIntoBatches([item({ status: "approved" }), item({ status: "recommended" })]);
    expect(rows[0].status).toBe("mixed");
  });
  it("drops items with no batch_id", () => {
    expect(groupIntoBatches([item({ batch_id: null })])).toEqual([]);
  });
});
