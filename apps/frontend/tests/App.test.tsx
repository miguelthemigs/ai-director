import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App.js";
import { FixtureRunClient } from "../src/data/FixtureRunClient.js";

describe("App shell", () => {
  it("opens on the Run screen", () => {
    render(<App client={new FixtureRunClient()} />);
    expect(screen.getByRole("heading", { name: /run/i, level: 1 })).toBeInTheDocument();
  });

  it("moves between the three screens from the navigation", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /architecture/i }));
    expect(screen.getByRole("heading", { name: /architecture/i, level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /versions/i }));
    expect(screen.getByRole("heading", { name: /versions/i, level: 1 })).toBeInTheDocument();
  });

  it("marks the current screen for assistive technology, not only visually", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /versions/i }));
    expect(screen.getByRole("link", { name: /versions/i })).toHaveAttribute("aria-current", "page");
  });
});
