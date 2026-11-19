import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@/types";
import { AgentGrid } from "../agent-grid";

const drawerState = vi.hoisted(() => ({
  lastOpen: false,
  lastAgentId: null as string | null,
}));

vi.mock("../agent-drawer", () => ({
  AgentDrawer: ({
    agent,
    open,
    onOpenChange,
  }: {
    agent: Agent | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => {
    drawerState.lastOpen = open;
    drawerState.lastAgentId = agent?.id ?? null;
    return open ? (
      <div data-testid="agent-drawer">
        <span>{agent?.name}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close drawer
        </button>
      </div>
    ) : null;
  },
}));

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent",
    name: "Agent",
    role: "worker",
    platform: "codex",
    status: "active",
    lastHeartbeat: new Date().toISOString(),
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    ...overrides,
  };
}

describe("AgentGrid batch13 coverage", () => {
  it("shows empty flat list state", () => {
    render(<AgentGrid agents={[]} />);
    expect(screen.getByText("No agents found.")).toBeInTheDocument();
  });

  it("renders sections mode with empty group messaging", () => {
    render(
      <AgentGrid
        sections={[
          { title: "Harnesses", agents: [agent({ id: "h1", name: "Harness One" })] },
          { title: "Idle", agents: [] },
        ]}
      />,
    );

    expect(screen.getByText("Harnesses")).toBeInTheDocument();
    expect(screen.getByText("No agents in this group")).toBeInTheDocument();
    expect(screen.getByText("Harness One")).toBeInTheDocument();
  });

  it("opens and closes the drawer from a card click", () => {
    render(<AgentGrid agents={[agent({ id: "worker-1", name: "Worker One" })]} />);

    fireEvent.click(screen.getByText("Worker One"));
    expect(drawerState.lastOpen).toBe(true);
    expect(drawerState.lastAgentId).toBe("worker-1");
    expect(screen.getByTestId("agent-drawer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(drawerState.lastOpen).toBe(false);
    expect(drawerState.lastAgentId).toBeNull();
  });
});
