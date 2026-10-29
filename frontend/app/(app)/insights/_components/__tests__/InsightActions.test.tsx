import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/trends",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams("run=v2"),
}));

import { InsightActions } from "../InsightActions";

const mount = (props: { hasData?: boolean }) =>
  render(<QueryClientProvider client={new QueryClient()}><InsightActions run="v2" {...props} /></QueryClientProvider>);

describe("InsightActions", () => {
  it("offers all four actions on a page with data, Run analysis secondary", () => {
    mount({});
    const run = screen.getByRole("button", { name: "Run analysis" });
    expect(run).toHaveClass("m-btn-secondary");
    expect(run).not.toHaveClass("m-btn-primary");
    expect(screen.getByRole("link", { name: "Review fixes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Present" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
  });

  it("drops Present and Export on a page with no data, keeping the ways to get data", () => {
    mount({ hasData: false });
    expect(screen.getByRole("button", { name: "Run analysis" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review fixes" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Present" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull();
  });
});
