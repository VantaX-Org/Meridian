import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as cleaningApi from "@/lib/api/cleaning";
import { ScoredPairs, scoredPairHref } from "../scored-pairs";

afterEach(() => vi.restoreAllMocks());

const OBJECTS = [{ value: "material_master", label: "Material master" }];
const PAIR: cleaningApi.DedupCandidate = {
  id: "c1", object_type: "material_master", record_key_a: "MATNR=1", record_key_b: "MATNR=2", match_score: 92,
  match_method: "fuzzy", match_fields: null, status: "pending", survivor_key: null, merged_at: null, created_at: "2026-10-01T00:00:00Z",
};

async function pick(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Object for scored pairs" }));
  const opt = await screen.findByRole("option", { name: label });
  fireEvent.mouseMove(opt);
  fireEvent.click(opt);
}

describe("ScoredPairs", () => {
  it("builds the Match review link for the cleaning source", () => {
    expect(scoredPairHref(PAIR)).toBe("/mdm/golden/merge?source=cleaning&object=material_master&record=MATNR%3D1");
  });

  it("asks for an object first and reads nothing", () => {
    const get = vi.spyOn(cleaningApi, "getDedupCandidatesByObject");
    renderWithQuery(<ScoredPairs objects={OBJECTS} />);
    expect(screen.getByText("No object chosen")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("lists the object's pairs, each row opening Match review", async () => {
    const get = vi.spyOn(cleaningApi, "getDedupCandidatesByObject").mockResolvedValue({ items: [PAIR], total: 1 });
    renderWithQuery(<ScoredPairs objects={OBJECTS} />);
    await pick("Material master");
    await waitFor(() => expect(get).toHaveBeenCalledWith("material_master"));
    expect(await screen.findByText("MATNR=1")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review MATNR=1 and MATNR=2 in Match review" })).toHaveAttribute("href", scoredPairHref(PAIR));
  });

  it("says so when no pair is pending", async () => {
    vi.spyOn(cleaningApi, "getDedupCandidatesByObject").mockResolvedValue({ items: [], total: 0 });
    renderWithQuery(<ScoredPairs objects={OBJECTS} />);
    await pick("Material master");
    expect(await screen.findByText("No pending pairs")).toBeInTheDocument();
  });

  it("shows the error with a retry", async () => {
    vi.spyOn(cleaningApi, "getDedupCandidatesByObject").mockRejectedValue(new Error("down"));
    renderWithQuery(<ScoredPairs objects={OBJECTS} />);
    await pick("Material master");
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});
