import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetCleaningFixture } from "@/lib/api/v2/fixtures/cleaning";
import { Cleansing } from "../screens/Cleansing";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

const dl = vi.hoisted(() => vi.fn(async (_p: string, _q: unknown, name: string) => name));
vi.mock("@/lib/api/v2/download", () => ({ v2Download: dl }));
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  resetCleaningFixture();
  dl.mockClear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/cleansing");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("cleansing export", () => {
  it("downloads the LSMW load file for the chosen status and object", async () => {
    renderWithQuery(<Cleansing />);
    const panel = await screen.findByTestId("cleansing-export");
    const form = await within(panel).findByRole("form", { name: "Export the corrected records" });
    const [status, object, format] = within(form).getAllByRole("combobox") as HTMLSelectElement[];
    expect(status.value).toBe("approved");
    expect([...status.options].map((o) => o.text).join("|")).toMatch(/Approved \(\d+\)/);
    const code = object.options[1].value;
    fireEvent.change(object, { target: { value: code } });
    fireEvent.change(format, { target: { value: "lsmw" } });
    fireEvent.submit(form);
    await waitFor(() => expect(dl).toHaveBeenCalledWith("/cleaning/export/lsmw", { status: "approved", object_type: code }, `cleaning-approved-${code}.txt`));
  });
});
