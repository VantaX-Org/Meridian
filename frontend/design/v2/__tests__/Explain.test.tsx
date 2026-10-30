import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import { Explain } from "../Explain";

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

function both() {
  return renderWithQuery(
    <div>
      <Explain metric="tolerance" label="Tolerance" module="material_master" />
      <Explain metric="coverage" label="Coverage" module="material_master" />
      <p>outside</p>
    </div>,
  );
}

describe("<Explain>", () => {
  it("is a button named for what it explains, closed until it is pressed", () => {
    both();
    const btn = screen.getByRole("button", { name: "About Tolerance" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a 320 pixel popover with the title, the plain-language text and the arithmetic from /explain", async () => {
    both();
    fireEvent.click(screen.getByRole("button", { name: "About Tolerance" }));
    const dialog = await screen.findByRole("dialog", { name: "Tolerance" });
    expect(dialog).toHaveStyle({ width: "320px" });
    await waitFor(() => expect(dialog).toHaveTextContent("A critical rule is over tolerance when its failing records reach 25 rows"));
    const calc = within(dialog).getByText("Rows").closest("div") as HTMLElement;
    expect(calc).toHaveTextContent("Rows25 records");
    expect(screen.getByRole("button", { name: "About Tolerance" })).toHaveAttribute("aria-expanded", "true");
  });

  it("takes focus when it opens, closes on Esc and gives focus back to the i", async () => {
    both();
    const btn = screen.getByRole("button", { name: "About Tolerance" });
    btn.focus();
    fireEvent.click(btn);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a click outside and on Tab, and the i toggles it", async () => {
    both();
    const btn = screen.getByRole("button", { name: "About Tolerance" });
    fireEvent.click(btn);
    await screen.findByRole("dialog");
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    await screen.findByRole("dialog");
    fireEvent.click(btn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows one popover at a time: opening a second closes the first", async () => {
    both();
    fireEvent.click(screen.getByRole("button", { name: "About Tolerance" }));
    await screen.findByRole("dialog", { name: "Tolerance" });
    fireEvent.click(screen.getByRole("button", { name: "About Coverage" }));
    expect(await screen.findByRole("dialog", { name: "Coverage of Material master" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "About Tolerance" })).toHaveAttribute("aria-expanded", "false");
  });

  it("asks the API only when it is opened, with the arguments it was given", async () => {
    const spy = vi.spyOn(objectApi, "getExplain");
    renderWithQuery(<Explain metric="failing_pct" label="Failing %" module="material_master" checkId="MM142" run="r1" />);
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "About Failing %" }));
    await screen.findByRole("dialog");
    expect(spy).toHaveBeenCalledWith("failing_pct", { module: "material_master", run: "r1", dimension: undefined, checkId: "MM142" });
  });

  it("says so, inside the popover, when the explanation cannot be read", async () => {
    vi.spyOn(objectApi, "getExplain").mockRejectedValue(new Error("down"));
    renderWithQuery(<Explain metric="cap" label="the cap" module="material_master" />);
    fireEvent.click(screen.getByRole("button", { name: "About the cap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The explanation could not be read for this run.");
  });

  it("keeps a figure the run did not store as a dash", async () => {
    vi.spyOn(objectApi, "getExplain").mockResolvedValue({ metric: "dqs", title: "Why it scores", text: "Text.", computation: [{ label: "Points", value: null, unit: "points" }], module: null, run_id: null, run_at: null });
    renderWithQuery(<Explain metric="dqs" label="the score" module="material_master" />);
    fireEvent.click(screen.getByRole("button", { name: "About the score" }));
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByText("Points")).closest("div")).toHaveTextContent("Points—");
  });
});
