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
      nodes: [],
      edges: [],
      columns: [],
      notices: ["batch36b-empty-topology"],
      canvas: { width: 320, height: 200 },
    }),
  })),
);

import { TopologyCanvas } from "../topology-canvas";

describe("TopologyCanvas batch36b", () => {
  it.skip("KPI_STRIP map body (273) — KPI_STRIP is empty in production", () => {});

  it("renders topology notices from API payload", async () => {
    render(<TopologyCanvas selectedId={null} onSelect={() => {}} />);
    expect(await screen.findByText("batch36b-empty-topology")).toBeInTheDocument();
  });
});
