import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  Delta,
  EnvelopeCaption,
  Eyebrow,
  formatFreshness,
  formatObservedAt,
  Legend,
  Mono,
  NocCard,
  NocPanelHeader,
  PillBtn,
  severityColor,
  SourceStatusBadge,
  statusBadgeColor,
} from "../noc-primitives";

describe("noc-primitives helpers", () => {
  it("formats observed timestamps and freshness buckets", () => {
    expect(formatObservedAt(null)).toBe("—");
    expect(formatObservedAt("not-a-date")).toBe("not-a-date");
    expect(formatObservedAt("2026-07-01T12:00:00.000Z")).toBe("2026-07-01 12:00:00Z");

    expect(formatFreshness(null)).toBe("—");
    expect(formatFreshness(15_000)).toBe("15s");
    expect(formatFreshness(90_000)).toBe("2m");
    expect(formatFreshness(3_600_000)).toBe("1h");
    expect(formatFreshness(86_400_000)).toBe("1d");
  });

  it("maps metric statuses to badge colors", () => {
    expect(statusBadgeColor("live").color).toBeTruthy();
    expect(statusBadgeColor("error").color).toBeTruthy();
    expect(severityColor("high")).toBeTruthy();
    expect(severityColor("info")).toBeTruthy();
  });
});

describe("noc-primitives components", () => {
  it("renders status badge with optional label override", () => {
    render(<SourceStatusBadge status="degraded" label="custom" />);
    expect(screen.getByText("custom")).toHaveAttribute("data-status", "degraded");
  });

  it("renders envelope caption for missing and live envelopes", () => {
    const { rerender } = render(<EnvelopeCaption envelope={null} />);
    expect(screen.getByText(/source: —/)).toBeInTheDocument();

    rerender(
      <EnvelopeCaption
        envelope={{
          value: 3,
          status: "stale",
          source: "sqlite",
          observedAt: "2026-07-01T00:00:00.000Z",
          freshnessMs: 120_000,
          scope: { window: "24h", workspace: "all" },
          reason: "index lagging",
        }}
        showScope
      />,
    );
    expect(screen.getByText(/index lagging/)).toBeInTheDocument();
    expect(screen.getByText(/scope: window=24h/)).toBeInTheDocument();
  });

  it("renders layout primitives and pill button variants", () => {
    const onClick = vi.fn();
    render(
      <NocCard>
        <NocPanelHeader title="Panel" hint="hint text" right={<span>right</span>} />
        <Eyebrow>Section</Eyebrow>
        <Mono>mono</Mono>
        <Delta value="+12%" />
        <Legend color="#000" label="Live" />
        <PillBtn onClick={onClick}>Action</PillBtn>
        <PillBtn href="/seal">Go</PillBtn>
      </NocCard>,
    );

    expect(screen.getByText("Panel")).toBeInTheDocument();
    expect(screen.getByText("hint text")).toBeInTheDocument();
    expect(screen.getByText("mono")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Action" }));
    expect(onClick).toHaveBeenCalled();

    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("href", "/seal");
    expect(link).toHaveAttribute("data-navigation-element", "anchor");
  });
});
