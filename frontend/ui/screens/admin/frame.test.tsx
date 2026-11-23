import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AletheiaProvider } from "@/ui/kit";
import { Frame } from "./common";

describe("admin Frame error state", () => {
  it("offers a retry that invalidates the admin queries", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <AletheiaProvider><Frame slug="x" title="Things" lead="l" error><p>ok</p></Frame></AletheiaProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["v2", "admin"] });
  });
});
