import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";
import { Jobs, took } from "../Jobs";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  setUrl("/runs?view=jobs&fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Jobs (next)", () => {
  it("lists the jobs natively, filters by kind and opens a job in the inspector", async () => {
    renderWithQuery(<Jobs />);
    expect(screen.getByTestId("jobs-page")).toBeTruthy();
    const table = await screen.findByRole("table", { name: /Jobs/ });
    await waitFor(() => expect(within(table).getAllByText("Extraction").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "analysis" } });
    await waitFor(() => expect(within(screen.getByRole("table", { name: /Jobs/ })).queryByText("Extraction")).toBeNull());
    const cell = within(screen.getByRole("table", { name: /Jobs/ })).getAllByText("Analysis")[0];
    fireEvent.click(cell.closest("tr") as HTMLElement);
    await waitFor(() => expect(getUrl()).toMatch(/open=job/));
  });

  it("says how long a job took", () => {
    expect(took(125)).toBe("2 m 5 s");
    expect(took(9)).toBe("9 s");
  });
});
