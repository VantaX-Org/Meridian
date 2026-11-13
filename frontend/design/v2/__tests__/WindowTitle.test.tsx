import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PageTitle } from "../parts";

describe("useWindowTitle", () => {
  it("lets only the first h1 hold the title, so two mounted screens do not fight over it forever", async () => {
    render(
      <>
        <PageTitle>First</PageTitle>
        <PageTitle>Second</PageTitle>
      </>,
    );
    expect(document.title).toBe("First – Meridian");
    // A head change is put back once; with two holders this never settled.
    document.head.appendChild(document.createElement("meta"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.title).toBe("First – Meridian");
  });
});
