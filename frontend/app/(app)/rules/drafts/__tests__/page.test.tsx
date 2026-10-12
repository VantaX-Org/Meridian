import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import RuleDraftsPage from "../page";

describe("rules drafts page", () => {
  it("shows the empty sentence when there are no drafts", async () => {
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([]);
    renderWithQuery(<RuleDraftsPage />);
    expect(await screen.findByText("No drafts")).toBeInTheDocument();
  });

  it("shows a loading skeleton while drafts load", () => {
    vi.spyOn(api, "getRuleDrafts").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<RuleDraftsPage />);
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
  });
});
