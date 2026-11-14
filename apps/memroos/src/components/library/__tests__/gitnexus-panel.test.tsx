import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { GitNexusPanel } from "../gitnexus-panel";

describe("GitNexusPanel", () => {
  it("shows empty state", () => {
    render(<GitNexusPanel repos={[]} />);
    expect(screen.getByText(/No GitNexus indexes found/i)).toBeInTheDocument();
  });

  it("renders repo stats", () => {
    render(
      <GitNexusPanel
        repos={[
          {
            name: "memroos",
            path: "/workspace",
            files: 1200,
            symbols: 21526,
            edges: 47013,
            clusters: 12,
            processes: 300,
            lastIndexed: "2026-07-01T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("memroos")).toBeInTheDocument();
    expect(screen.getByText("21.5k")).toBeInTheDocument();
  });
});
