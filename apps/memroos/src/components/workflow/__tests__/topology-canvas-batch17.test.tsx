/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopologyCanvas } from "../topology-canvas";

const TOPOLOGY_BATCH17 = {
  canvas: { width: 900, height: 420 },
  columns: [{ x: 120, label: "INGEST" }],
  notices: ["batch17 notice: synthetic edge dropped"],
  nodes: [
    { id: "source-a", label: "Source A", sub: "feed", x: 20, y: 80, w: 100, h: 44, t: "gate" as const, live: false },
    { id: "memroos", label: "MemroOS", sub: "core", x: 180, y: 60, w: 140, h: 110, t: "core" as const, live: true },
    { id: "agent-z", label: "Agent Z", sub: "active", x: 380, y: 80, w: 120, h: 44, t: "agent" as const, live: true },
  ],
  edges: [
    { from: "source-a", to: "memroos", weight: 0.4, kind: "flow" as const, measured: true },
    { from: "memroos", to: "agent-z", weight: 0.7, kind: "ctx" as const, measured: true },
    { from: "agent-z", to: "memroos", weight: 0.3, kind: "fb" as const, measured: false },
    { from: "missing-from", to: "agent-z", weight: 0.1, kind: "pack" as const, measured: false },
    { from: "memroos", to: "missing-to", weight: 0.1, kind: "loop" as const, measured: false },
  ],
};

describe("TopologyCanvas batch17", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => TOPOLOGY_BATCH17,
      })),
    );
  });

  it("renders flow/ctx/fb edge kinds and measured pulse paths", async () => {
    const { container } = render(<TopologyCanvas selectedId="memroos" onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("MemroOS")).toBeInTheDocument();
    });

    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll("circle animateMotion").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/batch17 notice/)).toBeInTheDocument();
  });

  it("selects agent nodes and forwards detail metadata", async () => {
    const onSelect = vi.fn();
    const onSelectNode = vi.fn();
    render(<TopologyCanvas selectedId={null} onSelect={onSelect} onSelectNode={onSelectNode} />);

    await waitFor(() => expect(screen.getByText("Agent Z")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent Z"));
    expect(onSelect).toHaveBeenCalledWith("agent-z");
    expect(onSelectNode).toHaveBeenCalledWith({ label: "Agent Z", sub: "active" });
  });
});
