/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Key } from "lucide-react";

const apiProviderMeta = vi.hoisted(() => ({
  key: "test-b39d-api",
  label: "Batch39d API",
}));

vi.mock("@/lib/tool-auth/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tool-auth/providers")>();
  const testApiProvider = {
    key: apiProviderMeta.key,
    label: apiProviderMeta.label,
    icon: Key,
    description: "API key provider for batch39d.",
    category: "other" as const,
    authMode: "api-key" as const,
    apiKeyField: "Secret key",
    docsUrl: "https://docs.test.local/b39d",
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

describe("ConnectedToolsPage batch39d", () => {
  it("ApiKeySheet returns null for unknown provider keys (line 547)", async () => {
    stubToolsFetch();
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText(apiProviderMeta.label)).toBeInTheDocument());
    expect(screen.queryByText(/Connect undefined/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste your API key/i)).not.toBeInTheDocument();
  });

  it("ApiKeySheet resets draft fields after close (534-545)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubToolsFetch();
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText(apiProviderMeta.label)).toBeInTheDocument());

    fireEvent.click(providerCard(screen, apiProviderMeta.label).querySelector("button") as HTMLButtonElement);
    await waitFor(() => screen.getByPlaceholderText(/Paste your API key/i));

    const keyInput = screen.getByPlaceholderText(/Paste your API key/i);
    fireEvent.change(keyInput, { target: { value: `secret-b39d-${randomUUID().slice(0, 8)}` } });
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await vi.runAllTimersAsync();

    fireEvent.click(providerCard(screen, apiProviderMeta.label).querySelector("button") as HTMLButtonElement);
    await waitFor(() => screen.getByPlaceholderText(/Paste your API key/i));
    expect(screen.getByPlaceholderText(/Paste your API key/i)).toHaveValue("");
  });
});