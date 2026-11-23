import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { getZAnomalies, getZEntry } from "@/lib/api/v2/sys";
import { resetSys6b } from "@/lib/api/v2/fixtures/sys6b";
import { CustomTab } from "./CustomTab";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); resetSys6b(); window.history.replaceState(null, "", "/s?fixture=1"); });
afterEach(() => undo());

const ui = () => renderWithQuery(<AletheiaProvider><ToastHost><CustomTab id="a1b2c3d4-0001-4000-8000-000000000001" /></ToastHost></AletheiaProvider>);

describe("Custom objects writes", () => {
  it("edits a registry entry from a fresh read and sends only what changed", async () => {
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Edit ZZPACKVAR" }));
    const dlg = await screen.findByRole("dialog", { name: "Edit custom object" });
    const owner = (await within(dlg).findByLabelText("Owner")) as HTMLInputElement;
    expect(owner.value).toBe("");
    const save = within(dlg).getByRole("button", { name: "Save custom object" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(owner, { target: { value: "R. Naidoo" } });
    fireEvent.click(save);
    await waitFor(async () => expect((await getZEntry("z-2")).owner).toBe("R. Naidoo"));
    expect((await getZEntry("z-2")).status).toBe("active");
  });

  it("confirms and dismisses an anomaly", async () => {
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm ZZPACKVAR" }));
    await waitFor(async () => expect((await getZAnomalies()).anomalies.find((a) => a.id === "za-1")?.status).toBe("confirmed"));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss ZMARA_EXT" }));
    await waitFor(async () => expect((await getZAnomalies()).anomalies.find((a) => a.id === "za-2")?.status).toBe("dismissed"));
  });
});
