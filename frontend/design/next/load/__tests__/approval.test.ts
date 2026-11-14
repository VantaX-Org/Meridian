import { describe, expect, it } from "vitest";
import { canReject, loadBlock, secondBlock } from "../approval";
import type { ApprovalState } from "@/lib/api/next/load";

const thabo = { id: "u1", name: "Thabo" };
const at = "2026-11-12T16:02:00Z";
const state = (over: Partial<ApprovalState> = {}): ApprovalState => ({ preparer: thabo, first: { ...thabo, at }, ...over });

describe("four-eyes matrix", () => {
  it("the preparer cannot give the second approval", () => {
    expect(secondBlock(state(), "u1")).toBe("preparer");
  });
  it("someone else can", () => {
    expect(secondBlock(state(), "u2")).toBeNull();
  });
  it("nobody gives the second before the first", () => {
    expect(secondBlock(state({ first: undefined }), "u2")).toBe("no-first");
  });
  it("a second approval is given once", () => {
    expect(secondBlock(state({ second: { id: "u2", name: "Ana", at } }), "u3")).toBe("done");
  });
  it("a rejected load takes no approval", () => {
    expect(secondBlock(state({ rejected: { id: "u2", name: "Ana", at, comment: "No" } }), "u3")).toBe("rejected");
  });
  it("a signed-out user cannot approve", () => {
    expect(secondBlock(state(), null)).toBe("signed-out");
  });
  it("a reject needs a comment", () => {
    expect(canReject("")).toBe(false);
    expect(canReject("   ")).toBe(false);
    expect(canReject("Wrong plant")).toBe(true);
  });
  it("load stays blocked until both approvals exist", () => {
    expect(loadBlock(state({ first: undefined }))).toBe("no-first");
    expect(loadBlock(state())).toBe("no-second");
    expect(loadBlock(state({ second: { id: "u2", name: "Ana", at } }))).toBeNull();
    expect(loadBlock(state({ second: { id: "u2", name: "Ana", at }, rejected: { id: "u2", name: "Ana", at, comment: "x" } }))).toBe("rejected");
  });
});
