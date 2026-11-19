import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
      {Content
        ? data.flatMap((d) => [
            <Content
              key={`${d.name}-wrap`}
              {...d}
              name="alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota-kappa"
              x={0}
              y={0}
              width={90}
              height={60}
            />,
          ])
        : null}
      {children}
    </div>
  ),
  Tooltip: ({
    content,
  }: {
    content?: (props: {
      active?: boolean;
      payload?: Array<{ payload: { name: string; docCount: number } }>;
    }) => React.ReactElement | null;
  }) => (
    <div data-testid="tooltip-batch22">
      {typeof content === "function"
        ? content({
            active: true,
            payload: [{ payload: { name: "wrapped", docCount: 9 } }],
          })
        : null}
    </div>
  ),
}));

import { CollectionTreemap } from "../collection-treemap";

describe("CollectionTreemap batch22", () => {
  it("wraps long labels and renders active tooltip payload", () => {
    render(
      <CollectionTreemap
        collections={[{ name: "wrapped", docCount: 9, category: "ops" }]}
      />,
    );
    expect(screen.getByTestId("treemap")).toBeInTheDocument();
    expect(screen.getByText("9 files")).toBeInTheDocument();
    expect(screen.getByText(/alpha- beta-/i)).toBeInTheDocument();
  });
});
