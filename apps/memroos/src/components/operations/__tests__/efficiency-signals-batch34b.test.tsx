/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EfficiencySignals } from "../efficiency-signals";

const api = vi.hoisted(() => ({
  useOperationsNoc: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useOperationsNoc: api.useOperationsNoc,
}));

const metrics = {
  totalEvents: 4,
  retrievalEvents: 0,
  retrievalUsedInFirstResponse: 0,
  retrievalBeforeWorkRate: null,
  sourceReadEvents: 0,
  repeatedSourceReads: 0,
  tokenLedgerEvents: 0,
  rawContextTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  rawContextTokenShare: null,
  operatorQuestions: 0,
  operatorReasks: 0,
  operatorReaskRate: null,
  memoryWrites: 0,
  rediscoveredWrites: 0,
  rediscoveredFactRate: null,
  recollection: null,
  streams: {
    retrieval_trace: 0,
    source_read: 0,
    token_ledger: 0,
    operator_question: 0,
    memory_write: 0,
  },
  lastUpdated: null,
};

describe("EfficiencySignals batch34b", () => {
  it("uses loading, error, and panel warning branches", () => {
    api.useOperationsNoc.mockReturnValue({ data: undefined, isLoading: true, isError: false });
  const { rerender } = render(<EfficiencySignals />);
    expect(screen.getByText(/^loading$/i)).toBeInTheDocument();

    api.useOperationsNoc.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    rerender(<EfficiencySignals />);
    expect(screen.getByText(/^degraded$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Unable to load efficiency telemetry/i).length).toBeGreaterThan(0);

    api.useOperationsNoc.mockReturnValue({
      data: {
        panels: {
          efficiency: {
            status: "degraded",
            source: "efficiency_events",
            warnings: ["panel-level warning"],
          },
        },
        metrics: {
          efficiency: {
            value: metrics,
            status: "live",
          },
        },
      },
      isLoading: false,
      isError: false,
    });
    rerender(<EfficiencySignals />);
    expect(screen.getByText(/4 efficiency events/i)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/panel-level warning/i);
  });

  it("normalizes missing recollection metrics to empty defaults", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        panels: {
          efficiency: {
            status: "empty",
            source: "efficiency_events",
            warnings: [],
          },
        },
        metrics: {
          efficiency: {
            value: metrics,
            status: "zero",
          },
        },
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(<EfficiencySignals />);
    expect(screen.getByText(/recollection decisions/i)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-card-state="blocked"]').length).toBeGreaterThan(0);
  });

  it("shows LIVE READ MODEL footer when warnings array is empty", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        panels: {
          efficiency: {
            status: "live",
            source: "efficiency_events",
            warnings: [],
          },
        },
        metrics: {
          efficiency: {
            value: {
              ...metrics,
              totalEvents: 10,
              streams: {
                retrieval_trace: 1,
                source_read: 1,
                token_ledger: 1,
                operator_question: 1,
                memory_write: 1,
              },
              retrievalEvents: 1,
              retrievalUsedInFirstResponse: 1,
              retrievalBeforeWorkRate: 1,
              sourceReadEvents: 1,
              repeatedSourceReads: 1,
              tokenLedgerEvents: 1,
              rawContextTokens: 1,
              totalTokens: 2,
              rawContextTokenShare: 0.5,
              operatorQuestions: 1,
              operatorReasks: 0,
              operatorReaskRate: 0,
              memoryWrites: 1,
              rediscoveredWrites: 0,
              rediscoveredFactRate: 0,
              recollection: {
                totalDecisions: 1,
                searchRequired: 1,
                searchSkipped: 0,
                injectedMemories: 0,
                ignoredCandidates: 0,
                policyDeniedCandidates: 0,
                belowThresholdCandidates: 0,
                skipReasons: {},
                beliefStageCounts: {
                  bronze_raw_source: 0,
                  silver_candidate_claim: 0,
                  gold_operational_truth: 1,
                },
                relianceCounts: {
                  direct_truth: 0,
                  caveated_claim: 0,
                  source_evidence_only: 0,
                },
                latestDecisions: [],
              },
            },
            status: "live",
          },
        },
      },
      isLoading: false,
      isError: false,
    });
    render(<EfficiencySignals />);
    expect(screen.getByText(/LIVE READ MODEL/i)).toBeInTheDocument();
    expect(screen.getByText(/All five Phase 117 efficiency streams/i)).toBeInTheDocument();
  });
});
