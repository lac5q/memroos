import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Treemap: ({
    data,
    content: Content,
    children,
  }: {
    data: Array<{ name: string; docCount: number; fill: string; size: number }>;
    content?: (props: Record<string, unknown>) => React.ReactElement;
    children?: React.ReactNode;
  }) => (
    <div data-testid="treemap">
      {data.map((d) => d.name).join(",")}
      {children}
      {Content
        ? data.flatMap((d) => [
            <Content
              key={`${d.name}-large`}
              {...d}
              x={0}
              y={0}
              width={120}
              height={80}
            />,
            <Content
              key={`${d.name}-small`}
              {...d}
              x={0}
              y={0}
              width={20}
              height={20}
            />,
            <Content
              key={`${d.name}-long`}
              {...d}
              name="very-long-collection-name-that-should-wrap-across-lines"
              x={0}
              y={0}
              width={60}
              height={50}
            />,
          ])
        : null}
    </div>
  ),
  Tooltip: ({
    content,
  }: {
    content?: React.ReactElement | ((props: {
      active?: boolean;
      payload?: Array<{ payload: { name: string; docCount: number } }>;
    }) => React.ReactElement | null);
  }) => (
    <div data-testid="tooltip-mock">
      {typeof content === "function"
        ? content({
            active: true,
            payload: [{ payload: { name: "playbooks", docCount: 5 } }],
          })
        : content}
    </div>
  ),
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
    expect(screen.getAllByText("playbooks").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 files").length).toBeGreaterThan(0);
    expect(screen.getByTestId("tooltip-mock")).toBeInTheDocument();
  });

  it("renders empty treemap when all collections have zero docs", () => {
    render(
      <CollectionTreemap
        collections={[
          { name: "empty-a", docCount: 0, category: "other" },
          { name: "empty-b", docCount: 0, category: "business" },
        ]}
      />,
    );
    expect(screen.getByTestId("treemap")).toHaveTextContent("");
  });
});
