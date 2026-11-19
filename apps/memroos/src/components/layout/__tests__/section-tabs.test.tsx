import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    "aria-current"?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/tools",
}));

import { SectionTabs } from "../section-tabs";

describe("SectionTabs", () => {
  it("marks active tab from pathname", () => {
    render(
      <SectionTabs
        tabs={[
          { label: "Tools", href: "/settings/tools", hint: "Connected tools" },
          { label: "Keys", href: "/settings/api-keys" },
        ]}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Section navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tools" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Keys" })).not.toHaveAttribute("aria-current");
  });
});
