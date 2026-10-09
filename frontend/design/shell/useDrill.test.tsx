// frontend/design/shell/useDrill.test.tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/objects/material_master/rules/CHK_001",
  useSearchParams: () => new URLSearchParams("run=v1&severity=critical"),
}));

import { useDrill } from "./useDrill";

describe("useDrill", () => {
  it("builds crumbs from the URL, each carrying the active search params", () => {
    const { result } = renderHook(() => useDrill());
    expect(result.current.crumbs.map((c) => c.label)).toEqual(["material_master", "CHK_001"]);
    expect(result.current.crumbs[0].href).toBe("/objects/material_master?run=v1&severity=critical");
    expect(result.current.crumbs[1].href).toBe("/objects/material_master/rules/CHK_001?run=v1&severity=critical");
  });

  it("up returns the parent crumb", () => {
    const { result } = renderHook(() => useDrill());
    expect(result.current.up?.label).toBe("material_master");
  });
});
