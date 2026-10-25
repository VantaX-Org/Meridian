// frontend/app/(app)/__tests__/presentation-escape.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppLayout from "../layout";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  usePathname: () => "/insights",
  useSearchParams: () => new URLSearchParams("present=1"),
}));
// Only the presentation chrome renders with ?present=1; the shell's providers and hooks are stubbed.
vi.mock("@/components/auth/auth-guard", () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/permissions", () => ({ PermissionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/use-preferences", () => ({ usePreferencesSync: () => undefined }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/use-jobs", () => ({ useJobs: () => ({ active: [] }) }));
vi.mock("@/hooks/use-nav", () => ({ useVisibleNav: () => [] }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ role: "viewer", can: () => false }) }));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/help/help-slot", () => ({ HelpSlot: () => null }));
vi.mock("@/components/scoped-pill", () => ({ ScopedPill: () => null }));
vi.mock("@/lib/client-errors", () => ({ reportClientError: () => undefined }));

function mount(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AppLayout>{children}</AppLayout></QueryClientProvider>);
}

afterEach(() => replace.mockClear());

describe("presentation mode Escape", () => {
  it("leaves the presentation on Escape", async () => {
    mount(<p>Slide</p>);
    expect(await screen.findByRole("button", { name: "Exit presentation" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(replace).toHaveBeenCalledWith("/insights");
  });

  it("leaves the key to an open dialog or drawer, and to anything that already handled it", async () => {
    mount(<div role="dialog" aria-label="Run analysis">Pick a system</div>);
    await screen.findByRole("button", { name: "Exit presentation" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores an Escape another handler already consumed", async () => {
    mount(<p>Slide</p>);
    await screen.findByRole("button", { name: "Exit presentation" });
    const ev = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    ev.preventDefault();
    window.dispatchEvent(ev);
    expect(replace).not.toHaveBeenCalled();
  });
});
