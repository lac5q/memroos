import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ContentViewer } from "../content-viewer";
import type { MemoryInventoryRow } from "@/lib/memory-inventory";

const row: MemoryInventoryRow = {
  id: "row-1",
  category: "vector_memory",
  label: "Vector memory",
  content: "Sample memory body",
  backend: "qdrant",
  source: "ingest",
  project: "memroos",
  workspace: null,
  timestamp: "2026-07-01T12:00:00.000Z",
  securityLabel: { visibility: "internal", domain: null, sensitivity: null, policy: null },
  consolidationState: "consolidated",
  salienceScore: 0.5,
  accessCount: 1,
  evidencePointer: "evidence://bundle-1",
  degradedReason: null,
  provenance: { sourceTable: "memories", sourceId: 1, sourceTimestamp: null },
};

describe("ContentViewer", () => {
  it("shows placeholder when no entry selected", () => {
    render(<ContentViewer entry={null} />);
    expect(screen.getByText("Select a memory to view its content.")).toBeInTheDocument();
  });

  it("renders entry metadata and content", () => {
    render(<ContentViewer entry={row} />);
    expect(screen.getByText("Vector memory")).toBeInTheDocument();
    expect(screen.getByText("Sample memory body")).toBeInTheDocument();
    expect(screen.getByText(/Source: ingest/)).toBeInTheDocument();
    expect(screen.getByText(/Project: memroos/)).toBeInTheDocument();
  });
});
