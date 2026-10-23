import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/config-matches";
import * as systemObjectsApi from "@/lib/api/system-objects";
import { ConfigMatchesTab } from "../config-matches-tab";

let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => { allowed = true; });
afterEach(() => vi.restoreAllMocks());

describe("ConfigMatchesTab", () => {
  it("shows the empty state when the run has no matches, with Re-run analysis re-checking this run", async () => {
    vi.spyOn(api, "getConfigMatches").mockResolvedValue({ items: [], total: 0 });
    const analyse = vi.spyOn(systemObjectsApi, "analyseVersion").mockResolvedValue({ status: "queued" });
    renderWithQuery(<ConfigMatchesTab versionId="v1" />);
    const empty = (await screen.findByText("No config matches yet")).closest("[data-state='empty']") as HTMLElement;
    await userEvent.click(within(empty).getByRole("button", { name: "Re-run analysis" }));
    await waitFor(() => expect(analyse).toHaveBeenCalledWith("v1"));
  });

  it("offers no Re-run analysis without the analyse permission", async () => {
    allowed = false;
    vi.spyOn(api, "getConfigMatches").mockResolvedValue({ items: [], total: 0 });
    renderWithQuery(<ConfigMatchesTab versionId="v1" />);
    await screen.findByText("No config matches yet");
    expect(screen.queryByRole("button", { name: "Re-run analysis" })).toBeNull();
  });
});
