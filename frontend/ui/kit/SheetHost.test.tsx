import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SheetHost } from "./SheetHost";
import { ToastHost } from "./Toast";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const sheets = { term: { label: "Glossary term", render: (a: unknown) => <p>term body {String(a)}</p> } };
const land = (search: string) => {
  window.history.replaceState({}, "", `/x${search}`);
  return render(<ToastHost><SheetHost sheets={sheets} closeLabel="Close">page</SheetHost></ToastHost>);
};

describe("SheetHost ?open deep link", () => {
  beforeEach(async () => { (await import("@/ui/testing/nav-store")).replace.mockClear(); });

  it("opens a registered kind as a sheet", () => {
    land("?open=term:t1");
    expect(screen.getByText("term body t1")).toBeTruthy();
  });

  it("sends a kind that moved to its routed page, keeping other params", async () => {
    land("?open=user:u1&fixture=1");
    const { replace } = await import("@/ui/testing/nav-store");
    expect(replace).toHaveBeenCalledWith("/admin/users?fixture=1");
  });

  it("sends an id kind to its detail route", async () => {
    land("?open=run:r9");
    const { replace } = await import("@/ui/testing/nav-store");
    expect(replace).toHaveBeenCalledWith("/run/r9");
  });

  it("says so when no page shows the kind", () => {
    land("?open=feature:f1");
    expect(screen.getByRole("status").textContent).toContain("feature, which has no page yet");
  });
});
