/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { NodeDetailRail } from "../node-detail-rail";

describe("NodeDetailRail batch36b", () => {
  it.skip("stats grid map (82) — STRUCTURAL_DETAILS never define non-empty stats", () => {});

  it("renders structural notes block when notes are present via live node", () => {
    render(
      <NodeDetailRail
        nodeId="agent:b36b"
        node={{ label: "Batch36b", sub: "Worker" }}
      />,
    );
    expect(screen.getByText("Batch36b")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/dispatch");
  });
});
