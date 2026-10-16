import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Treemap: ({ data }: { data: Array<{ name: string }> }) => (
    <div data-testid="treemap">{data.map((d) => d.name).join(",")}</div>
  ),
  Tooltip: () => null,
}));

import { CollectionTreemap } from "../collection-treemap";

describe("CollectionTreemap", () => {
  it("renders treemap for non-empty collections", () => {
    render(
      <CollectionTreemap
        collections={[
          { name: "playbooks", docCount: 5, category: "product" },
          { name: "empty-set", docCount: 0, category: "other" },
        ]}
      />,
    );

    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("treemap")).toHaveTextContent("playbooks");
    expect(screen.getByTestId("treemap")).not.toHaveTextContent("empty-set");
  });
});
