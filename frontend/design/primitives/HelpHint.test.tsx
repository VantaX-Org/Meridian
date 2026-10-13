import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/lib/help/glossary";
import { HelpHint } from "./HelpHint";
import { Stat } from "./Stat";

describe("HelpHint", () => {
  it("is a button named for the term", () => {
    render(<HelpHint term="dqs" />);
    expect(screen.getByRole("button", { name: "About Data quality score" })).toBeInTheDocument();
  });

  it("opens the long text and a learn more link on click", async () => {
    render(<HelpHint term="cap" />);
    expect(screen.queryByText(GLOSSARY.cap.long)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About Cap" }));
    expect(await screen.findByText(GLOSSARY.cap.long)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", GLOSSARY.cap.href);
  });

  it("reads each term's own entry", async () => {
    render(<HelpHint term="drift" />);
    fireEvent.click(screen.getByRole("button", { name: "About Drift" }));
    expect(await screen.findByText(GLOSSARY.drift.long)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", GLOSSARY.drift.href);
  });
});

describe("Stat help", () => {
  it("puts the hint beside the label of a plain tile", () => {
    render(<Stat label="Fitness" value="0.82" help="fitness" />);
    expect(screen.getByRole("button", { name: "About Fitness" })).toBeInTheDocument();
    expect(screen.getByText("Fitness")).toBeInTheDocument();
  });

  it("keeps the hint out of a link tile, so no button is nested in the anchor", () => {
    render(<Stat label="DQS" value="91" help="dqs" href="/runs" />);
    const tile = screen.getByRole("link");
    expect(tile.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "About Data quality score" })).toBeInTheDocument();
  });

  it("keeps the hint out of a button tile", () => {
    render(<Stat label="Waves" value={3} help="wave" onClick={() => {}} />);
    const tile = screen.getByText("Waves").closest("button.m-stat") as HTMLElement;
    expect(tile.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "About Wave" })).toBeInTheDocument();
  });

  it("renders no hint without help", () => {
    render(<Stat label="Runs" value={3} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
