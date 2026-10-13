import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import PreferencesPage from "../page";

describe("Preferences page", () => {
  it("shows display and guidance cards, and no notification controls nothing honours", () => {
    renderWithQuery(<PreferencesPage />);
    expect(screen.getByText("Display")).toBeInTheDocument();
    expect(screen.getByText("Guidance and saved views")).toBeInTheDocument();
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Digest")).not.toBeInTheDocument();
    expect(screen.queryByText(/critical findings/i)).not.toBeInTheDocument();
  });
});
