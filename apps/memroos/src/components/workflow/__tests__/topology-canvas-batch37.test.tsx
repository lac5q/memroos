/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({
    ok: true,
    json: async () => ({
      nodes: [{ id: "memroos", label: "Core", sub: "batch37", type: "core" as const, x: 0, y: 0 }],
      edges: [],
      columns: [],
      notices: ["batch37-topology-notice"],
      canvas: { width: 320, height: 200 },
    }),
  })),
);

import { TopologyCanvas } from "../topology-canvas";

describe("TopologyCanvas batch37", () => {
  it("renders topology payload notices from /api/flow/topology", async () => {
    render(<TopologyCanvas selectedId="memroos" onSelect={() => {}} />);
    expect(await screen.findByText("batch37-topology-notice")).toBeInTheDocument();
  });

  it.skip("KPI_STRIP map body (273) — KPI_STRIP is a fixed empty tuple in production", () => {});
});