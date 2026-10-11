import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import RuleDictionaryPage from "../page";

describe("rules dictionary page", () => {
  it("shows the fresh-install sentence, then a looked-up field", async () => {
    vi.spyOn(api, "getDdicFields").mockResolvedValue([
      { table: "MARA", field: "MATNR", domain: "MATNR", data_element: "MATNR", length: 40, missing: false } as api.DdicField,
    ]);
    renderWithQuery(<RuleDictionaryPage />);
    expect(screen.getByText(/No data dictionary snapshot yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Fields"), "MARA.MATNR");
    expect(await screen.findByText("MARA.MATNR")).toBeInTheDocument();
  });
});
