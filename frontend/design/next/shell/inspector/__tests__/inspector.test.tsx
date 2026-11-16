// The native inspector follows ?open=<kind>:<id>: nothing when closed, the ask panel, a group body, or the plain frame.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("../run", () => ({ RUN_BODIES: { run: ({ id }: { id: string }) => <p>run body {id}</p> } }));
vi.mock("../objects", () => ({ OBJECTS_BODIES: {} }));
vi.mock("../../AskBodyNative", () => ({ AskBodyNative: () => <p>ask body</p> }));

import { Inspector } from "../Inspector";

beforeEach(() => setUrl("/"));

describe("Inspector", () => {
  it("draws nothing when nothing is open", () => {
    const { container } = renderWithQuery(<Inspector />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the ask panel", () => {
    setUrl("/?open=ask:current");
    renderWithQuery(<Inspector />);
    expect(screen.getByText("Ask Meridian")).toBeInTheDocument();
    expect(screen.getByText("ask body")).toBeInTheDocument();
  });

  it("loads the group body for the kind", async () => {
    setUrl("/?open=run:v-1");
    renderWithQuery(<Inspector />);
    expect(await screen.findByText("run body v-1")).toBeInTheDocument();
  });

  it("a kind with nothing more shows the plain frame and closes", async () => {
    setUrl("/?open=term:T-1");
    renderWithQuery(<Inspector />);
    expect(await screen.findByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("This selection has nothing more to show. Close the inspector and choose a row.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(getUrl()).toBe("/");
  });
});
