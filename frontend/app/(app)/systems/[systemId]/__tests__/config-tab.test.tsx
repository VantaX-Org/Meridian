import { screen } from "@testing-library/react";
import { AxiosError } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/config-intelligence";
import { ConfigurationTab } from "../config-tab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems/s1",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => vi.restoreAllMocks());

describe("ConfigurationTab", () => {
  it("shows an honest empty state when no analysis exists (404)", async () => {
    const notFound = new AxiosError("nf", "ERR", undefined, undefined, { status: 404, data: {}, statusText: "", headers: {}, config: {} as never });
    for (const fn of ["getConfigHealth", "getConfigInventory"] as const) vi.spyOn(api, fn).mockRejectedValue(notFound);
    renderWithQuery(<ConfigurationTab systemId="s1" canPropose={false} />);
    expect(await screen.findByText("No configuration analysis yet.")).toBeInTheDocument();
  });
});
