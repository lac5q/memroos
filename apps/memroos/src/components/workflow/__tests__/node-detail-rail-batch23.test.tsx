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

describe("NodeDetailRail batch23", () => {
  it("routes structural memory and skills nodes to their consoles", () => {
    const { rerender } = render(<NodeDetailRail nodeId="memory" />);
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/notebooks");

    rerender(<NodeDetailRail nodeId="skills" />);
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/skills");

    rerender(<NodeDetailRail nodeId="knowledge" />);
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", "/library");
  });
});
