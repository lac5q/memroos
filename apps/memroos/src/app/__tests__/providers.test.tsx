import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Providers } from "../providers";

describe("Providers", () => {
  it("wraps children with query client context", () => {
    render(
      <Providers>
        <span data-testid="child">nested</span>
      </Providers>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("nested");
  });
});
