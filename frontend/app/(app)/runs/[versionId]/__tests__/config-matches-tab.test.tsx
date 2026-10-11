import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/config-matches";
import { ConfigMatchesTab } from "../config-matches-tab";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

afterEach(() => vi.restoreAllMocks());

describe("ConfigMatchesTab", () => {
  it("shows the empty state when the run has no matches", async () => {
    vi.spyOn(api, "getConfigMatches").mockResolvedValue({ items: [], total: 0 });
    renderWithQuery(<ConfigMatchesTab versionId="v1" />);
    expect(await screen.findByText("No config matches for this run.")).toBeInTheDocument();
  });
});
