import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const path = vi.hoisted(() => ({ current: "/home" }));
vi.mock("next/navigation", () => ({
  usePathname: () => path.current,
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn() }),
}));

import { Breadcrumb } from "./Breadcrumb";
import { PageHeader } from "../primitives/PageHeader";

const ROUTES = ["/home", "/objects", "/objects/vendor", "/runs", "/runs/abc", "/rules", "/systems", "/inbox", "/fix", "/mdm", "/insights", "/reports"];

describe("one h1 per page", () => {
  it.each(ROUTES)("%s renders exactly one h1 with the PageHeader below it", (route) => {
    path.current = route;
    render(<><Breadcrumb /><PageHeader title="Page title" /></>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2, name: "Page title" })).toHaveLength(1);
  });
});
