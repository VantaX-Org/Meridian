import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { listContracts } from "@/lib/api/v2/roles";
import { getContractBreaches } from "@/lib/api/v2/step9";
import { resetRolesFixture } from "@/lib/api/v2/fixtures/roles";
import { resetStep9Fixture } from "@/lib/api/v2/fixtures/step9";
import { Contracts } from "./Contracts";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/people?fixture=1"); resetRolesFixture(); resetStep9Fixture(); });
afterEach(() => undo());

const mount = () => renderWithQuery(<AletheiaProvider><ToastHost><Contracts /></ToastHost></AletheiaProvider>);

describe("contract terms and edits", () => {
  it("edits a draft contract", async () => {
    mount();
    const draft = (await listContracts()).contracts.find((c) => c.status === "draft")!;
    fireEvent.click(await screen.findByText(draft.name));
    fireEvent.change(await screen.findByLabelText(/^Name/, { selector: "input" }), { target: { value: "Renamed contract" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contract" }));
    await waitFor(async () => expect((await listContracts()).contracts.find((c) => c.id === draft.id)?.name).toBe("Renamed contract"));
  });

  it("asks before enforcing, then saves the terms", async () => {
    mount();
    const active = (await listContracts()).contracts.find((c) => c.status === "active")!;
    fireEvent.click(await screen.findByText(active.name));
    const toggle = await screen.findByRole("switch", { name: "Enforce on load" });
    if (toggle.getAttribute("aria-checked") === "true") fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText(/^Minimum score/), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save terms" }));
    expect(await screen.findByText(/pinning it as a baseline is refused/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enforce contract" }));
    await waitFor(async () => {
      const b = await getContractBreaches(active.id);
      expect(b.enforce).toBe(true);
      expect(b.thresholds.min_score).toBe(90);
    });
  });

  it("refuses a score above 100", async () => {
    mount();
    const active = (await listContracts()).contracts.find((c) => c.status === "active")!;
    fireEvent.click(await screen.findByText(active.name));
    fireEvent.change(await screen.findByLabelText(/^Minimum score/), { target: { value: "120" } });
    expect(screen.getByText("Minimum score must be from 0 to 100.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save terms" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("creates a contract for an object in three steps", async () => {
    mount();
    const before = (await listContracts()).contracts.length;
    fireEvent.click(await screen.findByRole("button", { name: "New contract for an object" }));
    const pick = await screen.findByLabelText(/^Object/);
    const first = (pick as HTMLSelectElement).options[1].value;
    fireEvent.change(pick, { target: { value: first } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText(/^Consumer/), { target: { value: "Finance" } });
    fireEvent.change(screen.getByLabelText(/^Minimum score/), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Finance/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create object contract" }));
    await waitFor(async () => expect((await listContracts()).contracts.length).toBe(before + 1));
  });
});
