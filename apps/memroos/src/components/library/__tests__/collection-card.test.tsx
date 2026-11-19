import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CollectionCard } from "../collection-card";

describe("CollectionCard", () => {
  it("renders collection name, count, and category", () => {
    render(
      <CollectionCard
        maxCount={20}
        collection={{
          name: "playbooks",
          docCount: 10,
          category: "product",
          metric: { status: "live", observedAt: "2026-07-01T00:00:00.000Z" },
        }}
      />,
    );

    expect(screen.getByText("playbooks")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("product")).toBeInTheDocument();
  });
});
