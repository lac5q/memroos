/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { NocHeader } from "../noc-header";

describe("NocHeader batch32", () => {
  const onWindowChange = vi.fn();
  const onWorkspaceChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses default onShowAdvancedChange without throwing (line 63)", () => {
    render(
      <NocHeader
        windowLabel="24h"
        workspace="all"
        showAdvanced={false}
        onWindowChange={onWindowChange}
        onWorkspaceChange={onWorkspaceChange}
      />,
    );
    const toggle = screen.getByRole("checkbox", { name: "Show advanced" });
    expect(() => fireEvent.click(toggle)).not.toThrow();
  });
});
