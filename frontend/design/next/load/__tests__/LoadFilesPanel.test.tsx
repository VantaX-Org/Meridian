import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { LoadFilesPanel } from "../LoadFilesPanel";

const blank = vi.fn();
vi.mock("@/lib/api/v2/migration", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/migration")>()), downloadBlankTemplate: (...a: unknown[]) => blank(...a) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => { window.sessionStorage.clear(); vi.clearAllMocks(); });

describe("load files panel", () => {
  it("sends the all-entities choice with the blank template", async () => {
    renderWithQuery(<LoadFilesPanel module="successfactors" />);
    await screen.findByTestId("load-files");
    fireEvent.click(screen.getByRole("checkbox", { name: /Include every entity/ }));
    fireEvent.click(screen.getByRole("button", { name: "Download blank template" }));
    await waitFor(() => expect(blank).toHaveBeenCalledWith("successfactors", true));
  });
});
