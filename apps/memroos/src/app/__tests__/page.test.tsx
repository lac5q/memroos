import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const headersMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("@/components/operations", () => ({
  OperationsNoc: () => <div data-testid="operations-noc">NOC</div>,
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <img alt={props.alt ?? ""} />,
}));

import HomePage from "../page";

describe("HomePage", () => {
  it("renders operator NOC for non-marketing hosts", async () => {
    headersMock.mockResolvedValue({
      get: (name: string) => (name === "host" ? "localhost:3000" : null),
    });

    const ui = await HomePage();
    render(ui);
    expect(screen.getByTestId("operations-noc")).toBeInTheDocument();
  });

  it("renders public landing for memroos.com", async () => {
    headersMock.mockResolvedValue({
      get: (name: string) => (name === "host" ? "memroos.com" : null),
    });

    const ui = await HomePage();
    render(ui);
    expect(screen.getByText(/Control your memory/i)).toBeInTheDocument();
  });
});
