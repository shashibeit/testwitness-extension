import { describe, expect, it } from "vitest";

import {
  detectBrowser,
  detectOperatingSystem,
  pageSupport,
  urlOrigin,
} from "../src/shared/browser";

describe("browser helpers", () => {
  it("allows normal web applications and rejects privileged pages", () => {
    expect(pageSupport("https://qa.example.test/login")).toEqual({
      supported: true,
    });
    expect(pageSupport("chrome://extensions").supported).toBe(false);
    expect(pageSupport("edge://settings").supported).toBe(false);
    expect(
      pageSupport("https://chromewebstore.google.com/detail/example").supported,
    ).toBe(false);
  });

  it("identifies Chromium browser metadata without using it for capabilities", () => {
    expect(
      detectBrowser(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toEqual({ name: "Microsoft Edge", version: "140.0.0.0" });
    expect(
      detectOperatingSystem(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)",
        "MacIntel",
      ),
    ).toEqual({
      name: "macOS",
      version: "15.0",
    });
    expect(urlOrigin("https://qa.example.test/path?token=secret")).toBe(
      "https://qa.example.test",
    );
  });
});
