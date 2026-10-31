/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useKnowledgeTrends: vi.fn(),
  useAuditLog: vi.fn(),
  useAgents: vi.fn(),
  useEvalConfig: vi.fn(),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

vi.mock("@/lib/api-client", () => api);

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/business-ops/kpi-timeline-panel", () => ({
  KpiTimelinePanel: () => <div data-testid="kpi-timeline" />,
}));
vi.mock("@/components/business-ops/adapter-status-panel", () => ({
  AdapterStatusPanel: () => <div data-testid="adapter-status" />,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ content }: { content?: React.ReactElement }) => content ?? null,
}));

import { CollectionTrendsPanel } from "@/components/library/collection-trends-panel";
import { AuditLogPanel } from "@/components/memroos/audit-log-panel";
import { NodeDetailRail } from "@/components/workflow/node-detail-rail";
import BusinessOpsPage from "@/app/business-ops/page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CollectionTrendsPanel batch22c", () => {
  it("renders trend cards and switches window", () => {
    api.useKnowledgeTrends.mockReturnValue({
      data: {
        collections: [
          {
            name: "Batch22c Collection",
            category: "business",
            totalFiles: 12,
            recentFiles: 0,
            lastUpdated: null,
            points: [{ bucket: "2026-07-01", value: 2, cumulative: 2 }],
          },
        ],
      },
      isLoading: false,
    });

    render(<CollectionTrendsPanel />);
    expect(screen.getByText(/Batch22c Collection/i)).toBeInTheDocument();
    expect(screen.getByText(/never updated/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(api.useKnowledgeTrends).toHaveBeenLastCalledWith("day", 12);
  });
});

describe("AuditLogPanel batch22c", () => {
  it("formats severities and relative timestamps", () => {
    api.useAuditLog.mockReturnValue({
      data: {
        entries: [
          {
            id: "e1",
            actor: "agent-batch22c",
            action: "memory.write",
            severity: "high",
            target: "vector:mem-1",
            timestamp: new Date(Date.now() - 120_000).toISOString(),
          },
          {
            id: "e2",
            actor: "system",
            action: "unknown.severity",
            severity: "unknown-batch22c",
            target: "system",
            timestamp: "not-a-date",
          },
        ],
      },
      isLoading: false,
    });

    render(<AuditLogPanel limit={5} />);
    expect(screen.getByText(/2m ago/i)).toBeInTheDocument();
    expect(screen.getByText(/memory.write/i)).toBeInTheDocument();
  });
});

describe("NodeDetailRail batch22c", () => {
  it("uses live node labels and suppresses link on flow sources", () => {
    const { rerender } = render(
      <NodeDetailRail nodeId="agent:ceo" node={{ label: "CEO Agent", sub: "Primary operator" }} />,
    );
    expect(screen.getByText("CEO Agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open page/i })).toHaveAttribute("href", "/dispatch");

    rerender(<NodeDetailRail nodeId="src:notion" node={{ label: "Notion", sub: "Connector" }} />);
    expect(screen.getByText(/Already on map/i)).toBeInTheDocument();
  });
});

describe("BusinessOpsPage batch22c", () => {
  it("switches agent filter and finance terminology title", () => {
    api.useAgents.mockReturnValue({
      data: { agents: [{ id: "ceo", name: "CEO" }] },
      isLoading: false,
    });
    api.useEvalConfig.mockReturnValue({
      data: {
        config: {
          finance: {
            enabled: true,
            transactionLabel: "Transaction",
            reconciliationLabel: "Reconciliation",
            exceptionLabel: "Exception",
          },
        },
      },
      isLoading: false,
    });

    wrap(<BusinessOpsPage />);
    expect(screen.getByText(/Finance Reconciliation/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Agent/i), { target: { value: "ceo" } });
    expect(screen.getByTestId("kpi-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("adapter-status")).toBeInTheDocument();
  });
});
