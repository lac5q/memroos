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

describe("NodeDetailRail batch37", () => {
  it("renders structural gateway details and outbound link", () => {
    render(<NodeDetailRail nodeId="gateway" />);
    expect(screen.getByText("Gateway")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/agents");
  });

  it.skip("stats grid map (82) — STRUCTURAL_DETAILS and live nodes always use stats: []", () => {});
});