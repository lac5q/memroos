import type React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { NodeDetailRail } from "../node-detail-rail";

describe("NodeDetailRail", () => {
  it("links the selected node CTA to its page", () => {
    render(<NodeDetailRail nodeId="memroos" />);

    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/");
  });

  it("routes agent nodes to dispatch and renders live labels", () => {
    render(<NodeDetailRail nodeId="agent:ceo" node={{ label: "CEO Agent", sub: "Executive orchestrator" }} />);
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/dispatch");
    expect(screen.getByText("CEO Agent")).toBeInTheDocument();
    expect(screen.getByText("Executive orchestrator")).toBeInTheDocument();
  });

  it("does not render a current-page Open page link for source nodes already shown on the map", () => {
    // Source ids are namespaced `src:<provider>` by the topology builder.
    render(<NodeDetailRail nodeId="src:slack" />);

    expect(screen.queryByRole("link", { name: /open page/i })).not.toBeInTheDocument();
    expect(screen.getByText(/already on map/i)).toBeInTheDocument();
  });
});
