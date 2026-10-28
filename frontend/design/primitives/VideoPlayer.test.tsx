import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoPlayer } from "./VideoPlayer";

describe("VideoPlayer", () => {
  it("points at the signed-in video route with the chapter's recording", () => {
    render(<VideoPlayer name="help-first-fix" title="Fix your first record" />);
    const video = screen.getByLabelText("Fix your first record: training video");
    expect(video).toHaveAttribute("src", "/api/v1/docs/help-videos/help-first-fix.mp4");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(screen.getByText("Fix your first record")).toBeInTheDocument();
  });

  it("falls back to an honest slot when the recording is not there yet", () => {
    render(<VideoPlayer name="help-first-fix" title="Fix your first record" />);
    fireEvent.error(screen.getByLabelText("Fix your first record: training video"));
    expect(screen.queryByLabelText("Fix your first record: training video")).toBeNull();
    expect(screen.getByText("Fix your first record: recording in preparation")).toBeInTheDocument();
  });
});
