import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import RuleDictionaryPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("rules dictionary page", () => {
  it("shows the fresh-install sentence, then a looked-up field", async () => {
    vi.spyOn(api, "getDdicFields").mockResolvedValue([
      { table: "MARA", field: "MATNR", domain: "MATNR", data_element: "MATNR", length: 40, missing: false } as api.DdicField,
    ]);
    renderWithQuery(<RuleDictionaryPage />);
    expect(screen.getByText(/No dictionary snapshot yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Fields"), "MARA.MATNR");
    expect(await screen.findByText("MARA.MATNR")).toBeInTheDocument();
  });

  it("offers an example on a fresh page, and says when a name is not in the dictionary", async () => {
    const get = vi.spyOn(api, "getDdicFields").mockResolvedValue([
      { table: "ZZZ", field: "NOPE", domain: null, data_element: null, length: null, missing: true } as unknown as api.DdicField,
    ]);
    renderWithQuery(<RuleDictionaryPage />);
    await userEvent.click(screen.getByRole("button", { name: "Try an example" }));
    expect(get).toHaveBeenCalledWith(["MARA.MATNR", "KNA1.KUNNR"]);
    await userEvent.clear(screen.getByLabelText("Fields"));
    await userEvent.type(screen.getByLabelText("Fields"), "ZZZ.NOPE");
    expect(await screen.findByText("Not in the dictionary")).toBeInTheDocument();
  });

  it("hints at tokens that are not TABLE.FIELD", async () => {
    vi.spyOn(api, "getDdicFields").mockResolvedValue([]);
    renderWithQuery(<RuleDictionaryPage />);
    await userEvent.type(screen.getByLabelText("Fields"), "MATNR");
    expect(screen.getByText("Not TABLE.FIELD, skipped: MATNR")).toBeInTheDocument();
  });

  it("shows a loading skeleton while the lookup runs", async () => {
    vi.spyOn(api, "getDdicFields").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<RuleDictionaryPage />);
    await userEvent.type(screen.getByLabelText("Fields"), "MARA.MATNR");
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
  });
});
