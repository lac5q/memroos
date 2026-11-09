/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TopologyCanvas } from "../topology-canvas";

describe("TopologyCanvas batch23", () => {
  it("skips pulse dots when measured endpoints are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          canvas: { width: 400, height: 200 },
          columns: [],
          notices: [],
          nodes: [{ id: "only", label: "Only", sub: "", x: 10, y: 10, w: 80, h: 40, t: "gate", live: false }],
          edges: [{ from: "ghost", to: "only", weight: 0.9, kind: "flow", measured: true }],
        }),
      })),
    );

    const { container } = render(<TopologyCanvas selectedId={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Only")).toBeInTheDocument());
    expect(container.querySelectorAll("circle animateMotion").length).toBe(0);
  });

  it("surfaces fetch errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    render(<TopologyCanvas selectedId={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Workflow map unavailable/i)).toBeInTheDocument());
  });
});
