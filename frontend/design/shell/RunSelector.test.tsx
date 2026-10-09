import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/objects/material_master",
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

import { RunSelector } from "./RunSelector";

describe("RunSelector", () => {
  it("rewrites ?run= on the current URL when a run is chosen", () => {
    render(<RunSelector runs={[{ id: "v1", label: "Run 1" }, { id: "v2", label: "Run 2" }]} />);
    fireEvent.change(screen.getByLabelText("Run"), { target: { value: "v2" } });
    expect(replace).toHaveBeenCalledWith("/objects/material_master?run=v2", { scroll: false });
  });
});
