import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CleansingFunnel } from "../_components/RunAnalyses";

const perms = vi.hoisted(() => ({ can: (() => true) as (action: string) => boolean }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.can(a) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/design", async (orig) => ({ ...(await orig<typeof import("@/design")>()), Funnel: () => null }));

const STEPS = [
  { key: "failing" as const, label: "Failing", records: 10 },
  { key: "proposed" as const, label: "Proposed", records: 4 },
];

afterEach(() => { perms.can = () => true; });

describe("CleansingFunnel", () => {
  it("offers Create remediation batch to a role that can apply fixes", () => {
    render(<CleansingFunnel steps={STEPS} run="v1" />);
    expect(screen.getByRole("link", { name: "Create remediation batch" })).toHaveAttribute("href", "/fix?run=v1&sugg=1");
  });

  it("hides Create remediation batch from a viewer", () => {
    perms.can = (a) => a === "view";
    render(<CleansingFunnel steps={STEPS} run="v1" />);
    expect(screen.queryByRole("link", { name: "Create remediation batch" })).toBeNull();
  });
});
