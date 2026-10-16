import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { TopologyCanvas } from "../topology-canvas";

const TOPOLOGY = {
  canvas: { width: 800, height: 400 },
  columns: [],
  notices: [],
  nodes: [
    { id: "memroos", label: "MemroOS", sub: "core", x: 10, y: 10, w: 120, h: 40, type: "core" as const },
  ],
  edges: [],
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
  });

  it("shows error when topology fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<TopologyCanvas selectedId={null} onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Workflow map unavailable/i)).toBeInTheDocument();
    });
  });
});
