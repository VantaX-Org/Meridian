import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ToastViewport, toastManager } from "./Toast";

describe("ToastViewport", () => {
  it("renders a toast added via toastManager while mounted", async () => {
    render(<ToastViewport />);

    act(() => {
      toastManager.add({ title: "Upload complete" });
    });

    expect(await screen.findByText("Upload complete")).toBeInTheDocument();
  });
});
