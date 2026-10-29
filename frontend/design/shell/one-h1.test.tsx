import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

// Source scan: the Breadcrumb owns the only h1. Add a path to ALLOWED only for a page that legitimately owns it (login, error).
const H1 = /<h1\b|as="h1"|level=\{1\}/;
// global-error.tsx and the root not-found.tsx render outside the shell, so no Breadcrumb exists to own the h1.
// design/v2/parts.tsx: Meridian 2 has no Breadcrumb; its PageTitle is the one h1 of each canvas.
const ALLOWED = new Set(["design/v2/parts.tsx", "design/shell/Breadcrumb.tsx", "components/auth/auth-frame.tsx", "app/global-error.tsx", "app/not-found.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === ".next" || n === "__tests__") return [];
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("h1 source scan", () => {
  it("no component outside the Breadcrumb renders an h1", () => {
    const root = process.cwd();
    const files = [...sources(join(root, "app")), ...sources(join(root, "design")), ...sources(join(root, "components")), ...sources(join(root, "hooks"))];
    expect(files.length).toBeGreaterThan(50);
    const hits = files.map((f) => f.slice(root.length + 1)).filter((rel) => !ALLOWED.has(rel) && H1.test(readFileSync(join(root, rel), "utf8")));
    expect(hits).toEqual([]);
  });
});
