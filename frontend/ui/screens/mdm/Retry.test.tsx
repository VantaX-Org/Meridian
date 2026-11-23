import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getMdmHealth } from "@/lib/api/v2/mdm-health";
import { AletheiaProvider } from "@/ui/kit";
import { Mdm } from "./Mdm";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/mdm-health", () => ({ getMdmHealth: vi.fn() }));

beforeEach(() => window.history.replaceState(null, "", "/mdm"));

describe("MDM error state", () => {
  it("offers a retry that refetches", async () => {
    vi.mocked(getMdmHealth).mockRejectedValue(new Error("boom"));
    renderWithQuery(<AletheiaProvider><Mdm /></AletheiaProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getMdmHealth).toHaveBeenCalledTimes(2));
  });
});
