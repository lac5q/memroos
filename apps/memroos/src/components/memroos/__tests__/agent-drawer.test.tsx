import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AgentDrawer } from "../agent-drawer";
import type { Agent } from "@/types";

const agent: Agent = {
  id: "agent-1",
  name: "Codex Worker",
  role: "Implementer",
  platform: "codex",
  status: "active",
  lastHeartbeat: "2026-07-01T12:00:00.000Z",
  currentTask: "Add smoke tests",
  lessonsCount: 4,
  todayMemoryCount: 2,
};

describe("AgentDrawer", () => {
  it("returns null without agent", () => {
    const { container } = render(<AgentDrawer agent={null} open onOpenChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders agent details when open", () => {
    render(<AgentDrawer agent={agent} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Codex Worker")).toBeInTheDocument();
    expect(screen.getByText("Implementer")).toBeInTheDocument();
    expect(screen.getByText("Add smoke tests")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
