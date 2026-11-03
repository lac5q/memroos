/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  id: "a2a-batch22",
  name: "A2A Batch22",
  role: "Worker",
  platform: "codex",
  protocol: "a2a",
  status: "active",
  lastHeartbeat: null,
  currentTask: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  capabilities: [],
  metadata: {
    a2a: {
      cardUrl: "ftp://not-http",
      endpointUrl: "ftp://not-http-endpoint",
      securitySchemes: "invalid",
      streaming: "maybe",
      source: "partner",
      inputModes: "text",
      outputModes: "json",
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

describe("AgentRegistryDrawer batch22", () => {
  it("redacts invalid URL hosts and unknown security metadata", () => {
    render(<AgentRegistryDrawer agent={a2aAgent} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("A2A connection")).toBeInTheDocument();
    expect(screen.getByText("PARTNER")).toBeInTheDocument();
    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ftp:/i).length).toBeGreaterThan(0);
  });
});
