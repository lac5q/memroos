import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopologyCanvas } from "../topology-canvas";

const TOPOLOGY = {
  canvas: { width: 800, height: 400 },
  columns: [{ x: 100, label: "Gateway" }],
  notices: ["No agents registered in this column."],
  nodes: [
    { id: "memroos", label: "MemroOS", sub: "core", x: 10, y: 60, w: 120, h: 100, t: "core" as const, live: false },
    { id: "agent-a", label: "Agent A", sub: "live", x: 200, y: 60, w: 120, h: 40, t: "agent" as const, live: true },
  ],
  edges: [
    { from: "memroos", to: "agent-a", weight: 0.5, kind: "pack" as const, measured: true },
    { from: "agent-a", to: "memroos", weight: 0.2, kind: "loop" as const, measured: false },
  ],
};

describe("TopologyCanvas", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => TOPOLOGY,
      })),
    );
  });

  it("shows loading then renders topology legend", async () => {
    render(<TopologyCanvas selectedId="memroos" onSelect={vi.fn()} />);
    expect(screen.getByText(/Loading live topology/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/MemroOS/)).toBeInTheDocument();
    });
    expect(screen.getByText(/capture → consolidate/)).toBeInTheDocument();
    expect(screen.getByText(/No agents registered in this column/)).toBeInTheDocument();
  });

  it("shows error when topology fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<TopologyCanvas selectedId={null} onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Workflow map unavailable/i)).toBeInTheDocument();
    });
  });

  it("selects nodes and emits detail metadata", async () => {
    const onSelect = vi.fn();
    const onSelectNode = vi.fn();
    render(<TopologyCanvas selectedId={null} onSelect={onSelect} onSelectNode={onSelectNode} />);

    await waitFor(() => expect(screen.getByText("Agent A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent A"));
    expect(onSelect).toHaveBeenCalledWith("agent-a");
    expect(onSelectNode).toHaveBeenCalledWith({ label: "Agent A", sub: "live" });
  });
});
