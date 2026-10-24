import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredAgent } from "@/types";

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

import { AgentRegistryDrawer } from "../agent-registry-drawer";

const a2aAgent: RegisteredAgent = {
  id: "adk-1",
  name: "ADK Prime",
  role: "Prime checks",
  platform: "gemini",
  protocol: "a2a",
  status: "active",
  lastHeartbeat: "2026-07-01T12:00:00.000Z",
  currentTask: "checking",
  lessonsCount: 0,
  todayMemoryCount: 0,
  location: "tailscale",
  isRemote: true,
  latencyMs: 40,
  capabilities: [{ id: "prime", name: "Check Prime", description: "", tags: [] }],
  metadata: {
    a2a: {
      cardUrl: "https://user:secret@agent.test.local/.well-known/agent-card.json",
      endpointUrl: "https://user:secret@agent.test.local/a2a",
      version: "1.0",
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      inputModes: ["text"],
      outputModes: ["text"],
      validationStatus: "validated",
      lastFetchedAt: "2026-07-01T00:00:00.000Z",
      source: "adk",
      streaming: true,
    },
  },
  host: "worker.test.local",
  port: 8001,
  healthEndpoint: "/.well-known/agent-card.json",
  tunnelUrl: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deregisteredAt: null,
};

describe("AgentRegistryDrawer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ agent: { ...a2aAgent, name: "Saved Name", role: "Saved role" } }),
      })),
    );
  });

  it("returns null when no agent is selected", () => {
    const { container } = render(
      <AgentRegistryDrawer agent={null} open={false} onOpenChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows A2A metadata and saves inline edits", async () => {
    const onAgentUpdated = vi.fn();
    render(
      <AgentRegistryDrawer
        agent={a2aAgent}
        liveness={{
          state: "live",
          source: "heartbeat",
          observedAt: "2026-07-01T12:00:00.000Z",
          freshnessMs: 5000,
          reason: "recent ping",
        }}
        open
        onOpenChange={vi.fn()}
        onAgentUpdated={onAgentUpdated}
      />,
    );

    expect(screen.getByTestId("sheet")).toBeInTheDocument();
    expect(screen.getByText("A2A connection")).toBeInTheDocument();
    expect(screen.getAllByText(/agent\.test\.local/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/secret@/)).not.toBeInTheDocument();
    expect(screen.getByText("checking")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("edit-agent-details"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saved Name" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Saved role" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onAgentUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Saved Name" }));
    });
  });

  it("surfaces save errors from the API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    } as Response);

    render(<AgentRegistryDrawer agent={a2aAgent} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("edit-agent-details"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Blocked Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Forbidden")).toBeInTheDocument();
    });
  });
});
