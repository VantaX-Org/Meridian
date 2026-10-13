import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import apiClient from "../client";
import { mineLearnedRules } from "../learnedRules";
import {
  allowedVersionTargets, createRuleDraft, deleteRuleDraft, dryRunRuleDraft, generateRuleDraft, publishRuleDraft,
  transitionRuleVersion, updateRuleDraft,
} from "../rule-authoring";

const client = vi.mocked(apiClient);
const BODY = { module: "accounts_payable", rule_yaml: "{}" };

beforeEach(() => {
  client.post.mockReset().mockResolvedValue({ data: { ok: true } });
  client.put.mockReset().mockResolvedValue({ data: { ok: true } });
  client.delete.mockReset().mockResolvedValue({ data: null });
});

describe("rule authoring wrappers", () => {
  it("generate posts the description", async () => {
    await generateRuleDraft({ module: "accounts_payable", description: "VAT is required" });
    expect(client.post).toHaveBeenCalledWith("/api/v1/rule-authoring/generate", { module: "accounts_payable", description: "VAT is required" });
  });

  it("dry run, create, update, delete and publish hit the draft endpoints", async () => {
    await dryRunRuleDraft(BODY);
    expect(client.post).toHaveBeenCalledWith("/api/v1/rule-authoring/dry-run", BODY);
    await createRuleDraft(BODY);
    expect(client.post).toHaveBeenCalledWith("/api/v1/rule-authoring/drafts", BODY);
    await updateRuleDraft("d 1", BODY);
    expect(client.put).toHaveBeenCalledWith("/api/v1/rule-authoring/drafts/d%201", BODY);
    await deleteRuleDraft("d1");
    expect(client.delete).toHaveBeenCalledWith("/api/v1/rule-authoring/drafts/d1");
    await publishRuleDraft("d1");
    expect(client.post).toHaveBeenCalledWith("/api/v1/rule-authoring/drafts/d1/publish");
  });

  it("transition posts the target state to the version", async () => {
    await transitionRuleVersion("AP001", 3, { to: "in_review", note: "ready" });
    expect(client.post).toHaveBeenCalledWith("/api/v1/rules/AP001/versions/3/transition", { to: "in_review", note: "ready" });
  });

  it("mirrors the lifecycle's allowed moves", () => {
    expect(allowedVersionTargets("draft")).toEqual(["in_review"]);
    expect(allowedVersionTargets("in_review")).toEqual(["draft", "active"]);
    expect(allowedVersionTargets("active")).toEqual(["retired"]);
    expect(allowedVersionTargets("retired")).toEqual([]);
    expect(allowedVersionTargets("unknown")).toEqual([]);
  });

  it("mine posts the version id", async () => {
    await mineLearnedRules("v1");
    expect(client.post).toHaveBeenCalledWith("/api/v1/learned-rules/mine", { version_id: "v1" });
  });
});
