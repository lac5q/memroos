/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Treemap: ({ content, data }: { content: React.ComponentType<unknown>; data: unknown[] }) => (
    <div data-testid="treemap-batch24">
      {data.map((item) => {
        const Comp = content;
        return <Comp key={(item as { name: string }).name} {...(item as object)} x={0} y={0} width={120} height={80} />;
      })}
    </div>
  ),
  Tooltip: ({ content: Content }: { content: React.ComponentType<{ active?: boolean; payload?: Array<{ payload: { name: string; docCount: number } }> }> }) => (
    <Content active payload={[{ payload: { name: "Ops Docs", docCount: 12 } }]} />
  ),
}));

import { CollectionTreemap } from "../collection-treemap";

describe("CollectionTreemap batch24", () => {
  it("renders collection cells and tooltip content", () => {
    render(
      <CollectionTreemap
        collections={[
          { id: "c1", name: "Ops Docs", category: "business", docCount: 12, description: "", updatedAt: "" },
          { id: "c2", name: "Empty", category: "other", docCount: 0, description: "", updatedAt: "" },
        ]}
      />,
    );
    expect(screen.getByTestId("treemap-batch24")).toBeInTheDocument();
    expect(screen.getByText("Ops Docs")).toBeInTheDocument();
    expect(screen.getByText("12 files")).toBeInTheDocument();
  });
});
