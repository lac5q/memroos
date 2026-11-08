/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Key } from "lucide-react";

vi.mock("@/lib/tool-auth/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tool-auth/providers")>();
  const testApiProvider = {
    key: "test-b30b-api",
    label: "Batch30b API",
    icon: Key,
    description: "API key provider for batch30b coverage.",
    category: "other" as const,
    authMode: "api-key" as const,
    apiKeyField: "Secret key",
    docsUrl: "https://docs.test.local/b30b",
  };
  return {
    ...actual,
    PROVIDERS_BY_KEY: {
      ...actual.PROVIDERS_BY_KEY,
      [testApiProvider.key]: testApiProvider,
    },
    getGroupedProviders: () => [
      { category: actual.CATEGORIES.other, providers: [testApiProvider] },
    ],
  };
});

import ConnectedToolsPage from "../page";
import { providerCard, stubToolsFetch, wrap } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConnectedToolsPage batch30b", () => {
  it("formats recent activity event labels", async () => {
    stubToolsFetch({
      activity: {
        events: [
          {
            id: "evt-1",
            connectionId: null,
            type: "connection_revoked",
            at: new Date().toISOString(),
            providerKey: "github",
          },
          {
            id: "evt-2",
            connectionId: null,
            type: "test_succeeded",
            at: new Date().toISOString(),
            providerKey: "slack",
          },
        ],
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("revoked")).toBeInTheDocument());
    expect(screen.getByText("test passed")).toBeInTheDocument();
  });

  it("validates API key length in connect sheet", async () => {
    stubToolsFetch();
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Batch30b API")).toBeInTheDocument());
    const card = providerCard(screen, "Batch30b API");
    fireEvent.click(within(card).getByRole("button", { name: /Connect/i }));
    const input = await screen.findByPlaceholderText(/Paste your API key/i);
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /Save connection/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("shows empty search state message", async () => {
    stubToolsFetch();
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Batch30b API")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Search providers/i), {
      target: { value: `no-match-${randomUUID().slice(0, 6)}` },
    });
    await waitFor(() => {
      expect(screen.getByText(/No providers match/i)).toBeInTheDocument();
    });
  });
});
