/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

const restAgent: RegisteredAgent = {
  id: "rest-1",
  name: "REST Worker",
  role: "Batch worker",
  platform: "codex",
  protocol: "rest",
  status: "idle",
  lastHeartbeat: null,
  currentTask: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  capabilities: [],
  metadata: {},
  host: null,
  port: null,
  healthEndpoint: null,
  tunnelUrl: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deregisteredAt: null,
};

describe("AgentRegistryDrawer batch15b", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ agent: { ...restAgent, name: "Renamed", role: "New role" } }),
      })),
    );
  });

  it("renders REST agent without A2A block and empty capabilities copy", () => {
    render(<AgentRegistryDrawer agent={restAgent} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText("A2A connection")).not.toBeInTheDocument();
    expect(screen.getByText("None declared")).toBeInTheDocument();
    expect(screen.getByText("never")).toBeInTheDocument();
  });

  it("cancels inline edits and blocks save when fields are cleared", () => {
    render(<AgentRegistryDrawer agent={restAgent} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("edit-agent-details"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("edit-agent-details")).toBeInTheDocument();
  });

  it("re-seeds inline editor state when the selected agent changes", () => {
    const { rerender } = render(<AgentRegistryDrawer agent={restAgent} open onOpenChange={vi.fn()} />);
    rerender(
      <AgentRegistryDrawer
        agent={{ ...restAgent, id: "rest-2", name: "Other Agent", role: "Other role" }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Other Agent")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-agent-details")).toBeInTheDocument();
  });

  it("labels non-adk A2A sources and streaming=false metadata", () => {
    const genericA2a: RegisteredAgent = {
      ...restAgent,
      protocol: "a2a",
      metadata: {
        a2a: {
          cardUrl: "not-a-valid-url",
          endpointUrl: "also-invalid",
          version: "0.9",
          securitySchemes: { apiKey: { type: "apiKey", in: "header" } },
          inputModes: ["text"],
          outputModes: ["json"],
          validationStatus: "pending",
          lastFetchedAt: "2026-07-01T00:00:00.000Z",
          source: "custom",
          streaming: false,
        },
      },
    };
    render(<AgentRegistryDrawer agent={genericA2a} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("A2A connection")).toBeInTheDocument();
    expect(screen.getByText("CUSTOM")).toBeInTheDocument();
    expect(screen.getByText("not declared")).toBeInTheDocument();
  });
});
