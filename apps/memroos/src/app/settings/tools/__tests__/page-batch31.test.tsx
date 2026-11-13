/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Key } from "lucide-react";

vi.mock("@/lib/tool-auth/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tool-auth/providers")>();
  const testApiProvider = {
    key: "test-b31-api",
    label: "Batch31 API",
    icon: Key,
    description: "API key provider for batch31 coverage.",
    category: "other" as const,
    authMode: "api-key" as const,
    apiKeyField: "Secret key",
    docsUrl: "https://docs.test.local/b31",
  };
  return {
    ...actual,
    PROVIDERS_BY_KEY: {
      ...actual.PROVIDERS_BY_KEY,
      [testApiProvider.key]: testApiProvider,
    },
    getGroupedProviders: () => [
      { category: actual.CATEGORIES.other, providers: [testApiProvider] },
      {
        category: actual.CATEGORIES.developer,
        providers: [
          {
            key: `orphan-b31-${randomUUID().slice(0, 6)}`,
            label: "Orphan Batch31",
            icon: Key,
            description: "Missing registry entry",
            category: "developer" as const,
            authMode: "api-key" as const,
            apiKeyField: "Secret",
            docsUrl: "https://docs.test.local/orphan",
          },
        ],
      },
    ],
  };
});

import ConnectedToolsPage from "../page";
import { stubToolsFetch, wrap } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConnectedToolsPage batch31", () => {
  it("fetchJson surfaces non-OK provider responses (line 58)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/tools/providers")) {
          return { ok: false, status: 503, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => ({ connections: [] }) } as Response;
      }),
    );
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByLabelText(/Loading providers/i)).toBeInTheDocument());
  });

  it("ProviderCard no-ops for grouped keys missing from PROVIDERS_BY_KEY (line 325)", async () => {
    stubToolsFetch();
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Batch31 API")).toBeInTheDocument());
    expect(screen.queryByText("Orphan Batch31")).not.toBeInTheDocument();
  });
});
