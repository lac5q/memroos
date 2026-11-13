/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredAgent } from "@/types";
import type { LivenessObservation } from "@/lib/agent-liveness";

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

import { AgentRegistryDrawer } from "../agent-registry-drawer";

const baseAgent: RegisteredAgent = {
  id: "drawer-b34b",
  name: "Drawer Agent",
  role: "Batch34b",
  platform: "unknown-platform",
  protocol: "a2a",
  status: "active",
  lastHeartbeat: "2026-07-15T12:00:00.000Z",
  currentTask: "sync registry",
  lessonsCount: 0,
  todayMemoryCount: 0,
  capabilities: [{ id: "cap", name: "Cap", description: "", tags: [] }],
  metadata: {
    a2a: {
      endpointUrl: 123,
      cardUrl: "https://user:secret@example.test/card.json",
      version: "1.1",
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
        anon: { type: "open" },
      },
      inputModes: ["text"],
      outputModes: ["json"],
      source: "adk",
      streaming: true,
      validationStatus: "ok",
      lastFetchedAt: "2026-07-15T12:00:00.000Z",
    },
  },
  host: null,
  port: null,
  healthEndpoint: null,
  tunnelUrl: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deregisteredAt: null,
};

const liveness: LivenessObservation = {
  state: "live",
  observedAt: "2026-07-15T12:00:00.000Z",
  freshnessMs: 2500,
  source: "sqlite://registered_agents",
  reason: "heartbeat fresh",
};

describe("AgentRegistryDrawer batch34b", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    );
  });

  it("renders ADK badges, platform fallback, redacted URLs, and liveness details", () => {
    render(
      <AgentRegistryDrawer agent={baseAgent} liveness={liveness} open onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText("unknown-platform")).toBeInTheDocument();
    expect(screen.getAllByText("ADK").length).toBeGreaterThan(0);
    expect(screen.getByText("sync registry")).toBeInTheDocument();
    expect(screen.getByText(/example\.test/)).toBeInTheDocument();
    expect(screen.getByText(/http bearer/i)).toBeInTheDocument();
    expect(screen.getByText(/observed at/i)).toBeInTheDocument();
    expect(screen.getByText(/age 3s/i)).toBeInTheDocument();
    expect(screen.getByText(/heartbeat fresh/i)).toBeInTheDocument();
    expect(screen.queryByText(/secret@/i)).not.toBeInTheDocument();
  });

  it("surfaces save failures for non-Error throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "network down";
      }),
    );
    render(<AgentRegistryDrawer agent={baseAgent} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("edit-agent-details"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeInTheDocument();
    });
  });
});
