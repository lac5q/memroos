import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredAgent } from "@/types";

const mutate = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useUpdateAgentDetailsMutation: () => ({
    mutate,
    isPending: false,
  }),
}));

import { AgentRegistryTable } from "../agent-registry-table";

const baseAgent: RegisteredAgent = {
  id: "agent-a",
  name: "Alpha Agent",
  role: "Does alpha work",
  platform: "cursor",
  protocol: "rest",
  status: "active",
  lastHeartbeat: "2026-07-01T12:00:00.000Z",
  currentTask: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  location: "local",
  isRemote: false,
  latencyMs: null,
  capabilities: [
    { id: "c1", name: "Cap One", description: "", tags: [] },
    { id: "c2", name: "Cap Two", description: "", tags: [] },
    { id: "c3", name: "Cap Three", description: "", tags: [] },
  ],
  metadata: {},
  host: null,
  port: null,
  healthEndpoint: null,
  tunnelUrl: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deregisteredAt: null,
};

describe("AgentRegistryTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutate.mockImplementation((_input, opts: { onSuccess?: (r: { agent: RegisteredAgent }) => void }) => {
      opts?.onSuccess?.({
        agent: { ...baseAgent, name: "Renamed", role: "Updated role" },
      });
    });
  });

  it("shows empty state with optional reason", () => {
    render(
      <AgentRegistryTable
        agents={[]}
        onSelect={vi.fn()}
        onDeregister={vi.fn()}
        emptyTitle="No agents"
        emptyReason="Registry sync pending"
      />,
    );
    expect(screen.getByText("No agents")).toBeInTheDocument();
    expect(screen.getByText("Registry sync pending")).toBeInTheDocument();
  });

  it("selects agent and deregisters from row actions", () => {
    const onSelect = vi.fn();
    const onDeregister = vi.fn();
    render(
      <AgentRegistryTable agents={[{ ...baseAgent }]} onSelect={onSelect} onDeregister={onDeregister} />,
    );

    fireEvent.click(screen.getByText("Alpha Agent"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-a" }));

    fireEvent.click(screen.getByRole("button", { name: "Deregister" }));
    expect(onDeregister).toHaveBeenCalledWith("agent-a");
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("inline-edits agent name and description", async () => {
    const onAgentUpdated = vi.fn();
    render(
      <AgentRegistryTable
        agents={[{ ...baseAgent }]}
        onSelect={vi.fn()}
        onDeregister={vi.fn()}
        onAgentUpdated={onAgentUpdated}
      />,
    );

    fireEvent.click(screen.getByTestId("edit-agent-agent-a"));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Agent description"), { target: { value: "Updated role" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        { agentId: "agent-a", name: "Renamed", role: "Updated role" },
        expect.any(Object),
      );
      expect(onAgentUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed" }));
    });
  });
});
