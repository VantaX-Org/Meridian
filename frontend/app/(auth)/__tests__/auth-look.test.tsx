import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-inter-var", className: "" }) }));
vi.mock("@/lib/api/licence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/licence")>()),
  getLicenceManifest: vi.fn().mockResolvedValue({ valid: false, status: "expired", expiry_date: null, tenant_id: "dep-test" }),
}));

import AuthLayout from "../layout";
import LicenceErrorPage from "../licence-error/page";

describe("signed-out pages on the shared tokens", () => {
  it("puts every signed-out page under the standalone token root", () => {
    render(<AuthLayout><p>child page</p></AuthLayout>);
    const child = screen.getByText("child page");
    const next = child.closest(".mx-root.mx-standalone");
    expect(next).toBeTruthy();
  });

  it("draws Retry with the kit button and still reloads the app root", async () => {
    const replace = vi.fn();
    const before = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...before, origin: "http://localhost", replace } });
    try {
      render(<LicenceErrorPage />);
      const retry = await screen.findByRole("button", { name: "Retry" });
      expect(retry.getAttribute("data-variant")).toBe("primary");
      fireEvent.click(retry);
      expect(replace).toHaveBeenCalledWith("http://localhost");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: before });
    }
  });
});
