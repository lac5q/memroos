import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ActivityFeed } from "../activity-feed";

describe("ActivityFeed", () => {
  it("shows empty state", () => {
    render(<ActivityFeed events={[]} />);
    expect(screen.getByText("No recent activity detected")).toBeInTheDocument();
  });

  it("renders events and forwards hover", () => {
    const onNodeHover = vi.fn();
    render(
      <ActivityFeed
        events={[
          {
            id: "1",
            timestamp: new Date().toISOString(),
            node: "mem0",
            type: "memory",
            message: "Indexed batch",
            severity: "info",
          },
        ]}
        onNodeHover={onNodeHover}
        highlightedNode="mem0"
      />,
    );
    expect(screen.getByText("mem0")).toBeInTheDocument();
    expect(screen.getByText("Indexed batch")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText("mem0"));
    expect(onNodeHover).toHaveBeenCalledWith("mem0");
  });

  it("renders error severity events with warn styling", () => {
    render(
      <ActivityFeed
        events={[
          {
            id: "err-1",
            timestamp: new Date().toISOString(),
            node: "agents",
            type: "error",
            message: "Pipeline failed",
            severity: "error",
          },
        ]}
      />
    );
    expect(screen.getByText("Pipeline failed")).toBeInTheDocument();
    expect(screen.getByText("agents")).toHaveStyle({ color: "#f43f5e" });
    expect(screen.getByText("⚠️")).toBeInTheDocument();
  });
});
