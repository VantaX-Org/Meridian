import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { ToastHost } from "@/ui/kit";
import { DbLoad } from "./DbLoad";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
const can = vi.hoisted(() => ({ allow: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allow }));

let undo: () => void = () => undefined;
beforeEach(() => { can.allow = true; undo = stubLayout(); window.history.replaceState(null, "", "/admin?fixture=1"); });
afterEach(() => undo());

const mount = () => renderWithQuery(<ToastHost><DbLoad connId="xdb-1" connName="Inventory replica" maxRows={100000} /></ToastHost>);

async function toPreview() {
  const sel = await screen.findByLabelText("Table");
  fireEvent.change(sel, { target: { value: "public\u0000parts" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview the first rows" }));
  await screen.findByText("Hydraulic hose 25 mm");
}

describe("DbLoad", () => {
  it("previews rows, then loads only after a confirm that names the cap", async () => {
    mount();
    await toPreview();
    expect((screen.getByRole("button", { name: "Review the load" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Object to load into"), { target: { value: "material_master" } });
    fireEvent.change(screen.getByLabelText("Field for descr"), { target: { value: "MAKT.MAKTX" } });
    fireEvent.click(screen.getByRole("button", { name: "Review the load" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toContain("Up to 100000 rows");
    expect(dlg.textContent).toContain("1 column renamed");
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("fx-xdb-v1")).toBeTruthy();
  });

  it("blocks without the permission and says why", async () => {
    can.allow = false;
    mount();
    expect(await screen.findByText("Loading from a database needs the manage systems permission.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Preview the first rows" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the refusal when a query holds two statements, with a retry", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Source"), { target: { value: "query" } });
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "SELECT 1; DROP TABLE x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview the first rows" }));
    expect(await screen.findByText("The preview failed.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
  });
});
