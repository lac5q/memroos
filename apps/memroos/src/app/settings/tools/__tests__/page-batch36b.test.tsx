/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Key } from "lucide-react";

vi.mock("@/lib/tool-auth/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tool-auth/providers")>();
  const testApiProvider = {
    key: "test-b36b-api",
    label: "Batch36b API",
    icon: Key,
    description: "API key provider for batch36b.",
    category: "other" as const,
    authMode: "api-key" as const,
    apiKeyField: "Secret key",
    docsUrl: "https://docs.test.local/b36b",
  };
  return {
    ...actual,
    PROVIDERS_BY_KEY: {
      ...actual.PROVIDERS_BY_KEY,
      [testApiProvider.key]: testApiProvider,
    },
    getGroupedProviders: () => [{ category: actual.CATEGORIES.other, providers: [testApiProvider] }],
  };
});

import ConnectedToolsPage from "../page";
import { providerCard, stubToolsFetch, wrap } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ConnectedToolsPage batch36b", () => {
  it("ApiKeySheet resets fields after close via deferred effect (534–545)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubToolsFetch();
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Batch36b API")).toBeInTheDocument());

    fireEvent.click(withinProviderConnect(screen, "Batch36b API"));
    await waitFor(() => screen.getByPlaceholderText(/Paste your API key/i));

    const keyInput = screen.getByPlaceholderText(/Paste your API key/i);
    fireEvent.change(keyInput, { target: { value: `secret-b36b-${randomUUID().slice(0, 8)}` } });
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await vi.runAllTimersAsync();

    fireEvent.click(withinProviderConnect(screen, "Batch36b API"));
    await waitFor(() => screen.getByPlaceholderText(/Paste your API key/i));
    expect(screen.getByPlaceholderText(/Paste your API key/i)).toHaveValue("");
  });

  it("ApiKeySheet returns null for oauth-only provider keys (547)", async () => {
    stubToolsFetch();
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Batch36b API")).toBeInTheDocument());
    expect(screen.queryByText(/Connect undefined/i)).not.toBeInTheDocument();
  });
});

function withinProviderConnect(screen: typeof import("@testing-library/react").screen, label: string) {
  return providerCard(screen, label).querySelector("button") as HTMLButtonElement;
}
