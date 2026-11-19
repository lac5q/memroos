import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import ConnectedToolsPage from "../page";
import { stubToolsFetch, wrap } from "./test-helpers";

describe("ConnectedToolsPage", () => {
  beforeEach(() => {
    stubToolsFetch();
  });

  it("renders connected tools header", async () => {
    wrap(<ConnectedToolsPage />);
    expect(screen.getByText("Connected Tools")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search providers/i)).toBeInTheDocument();
    });
  });

  it("lists providers from the registry once providers API resolves", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
  });

  it("shows empty-state copy when search matches no providers", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Search providers/i)).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/Search providers/i);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    fireEvent.change(input, { target: { value: "zzzz-no-match" } });
    await waitFor(() => {
      expect(screen.getByText(/No providers match/i)).toBeInTheDocument();
    });
  });
});

describe("ConnectedToolsPage enriched dashboard state", () => {
  beforeEach(() => {
    stubToolsFetch({
      activity: {
        events: [
          {
            id: "evt-1",
            providerKey: "github",
            type: "test_succeeded",
            connectionId: "c1",
            at: new Date().toISOString(),
          },
        ],
      },
      usage: {
        usage: { used: 4, limit: 5, plan: "starter" },
        approachingLimit: true,
      },
    });
  });

  it("renders usage meter, recent activity, and empty-connection guidance", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("4 of 5 connections used")).toBeInTheDocument();
      expect(screen.getByText("RECENT ACTIVITY")).toBeInTheDocument();
      expect(screen.getByText("test passed")).toBeInTheDocument();
      expect(screen.getByText(/No tools connected yet/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Upgrade Nango plan/i })).toBeInTheDocument();
    });
  });
});
