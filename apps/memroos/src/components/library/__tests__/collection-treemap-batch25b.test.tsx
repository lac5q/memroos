/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Treemap: () => <div data-testid="treemap-empty-b25b" />,
  Tooltip: () => null,
}));

import { CollectionTreemap } from "../collection-treemap";

describe("CollectionTreemap batch25b", () => {
  it("renders treemap shell when all collections have zero docs", () => {
    render(
      <CollectionTreemap
        collections={[
          { id: "c0", name: "Empty", category: "other", docCount: 0, description: "", updatedAt: "" },
        ]}
      />,
    );
    expect(screen.getByTestId("treemap-empty-b25b")).toBeInTheDocument();
  });
});
