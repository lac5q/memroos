/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { NodeDetailRail } from "../node-detail-rail";

describe("NodeDetailRail batch24", () => {
  it("links gateway and outcomes structural nodes", () => {
    const { rerender } = render(<NodeDetailRail nodeId="gateway" />);
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/agents");

    rerender(<NodeDetailRail nodeId="outcomes" />);
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/business-ops");
  });

  it("shows live node labels for derived agents", () => {
    render(<NodeDetailRail nodeId="agent:worker-b24" node={{ label: "Worker B24", sub: "Handles tasks" }} />);
    expect(screen.getByText("Worker B24")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/dispatch");
  });
});
