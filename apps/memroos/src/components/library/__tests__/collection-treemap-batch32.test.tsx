/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Treemap: ({
    content,
    data,
    children,
  }: {
    content: React.ComponentType<unknown>;
    data: unknown[];
    children?: React.ReactNode;
  }) => (
    <div data-testid="treemap-batch32">
      {data.map((item) => {
        const Comp = content;
        return (
          <Comp
            key={(item as { name: string }).name}
            {...(item as object)}
            x={0}
            y={0}
            width={55}
            height={55}
          />
        );
      })}
      {children}
    </div>
  ),
  Tooltip: ({ content }: { content: React.ReactElement }) => {
    const Comp = content.type as React.ComponentType<{
      active?: boolean;
      payload?: Array<{ payload: { name: string; docCount: number } }>;
    }>;
    return (
      <div data-testid="treemap-tooltip-batch32">
        <Comp active payload={[{ payload: { name: "Tooltip Batch32", docCount: 7 } }]} />
      </div>
    );
  },
}));

import { CollectionTreemap } from "../collection-treemap";

describe("CollectionTreemap batch32", () => {
  it("truncates wrapped labels and renders tooltip payload (lines 60-61, 123-124)", () => {
    const longName = "alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota";
    render(
      <CollectionTreemap
        collections={[
          {
            id: "c-b32",
            name: longName,
            category: "product",
            docCount: 21,
            description: "",
            updatedAt: "",
          },
        ]}
      />,
    );
    expect(screen.getByTestId("treemap-batch32")).toBeInTheDocument();
    expect(screen.getByText(/21 files/)).toBeInTheDocument();
    expect(screen.getByText(/gamma/)).toBeInTheDocument();
    expect(screen.getByText("Tooltip Batch32")).toBeInTheDocument();
    expect(screen.getByText("7 files")).toBeInTheDocument();
  });
});
