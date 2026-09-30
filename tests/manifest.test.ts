import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface Manifest {
  manifest_version: number;
  minimum_chrome_version: string;
  permissions: string[];
  optional_host_permissions?: string[];
  action: { default_popup?: string };
  content_security_policy: { extension_pages: string };
}

describe("Manifest V3 security baseline", () => {
  it("uses the privacy-first permission allowlist", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(process.cwd(), "src/manifest.json"), "utf8"),
    ) as Manifest;
    expect(manifest.manifest_version).toBe(3);
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
    expect(manifest.permissions.sort()).toEqual(
      [
        "activeTab",
        "downloads",
        "offscreen",
        "scripting",
        "sidePanel",
        "storage",
        "tabCapture",
      ].sort(),
    );
    expect(manifest.permissions).not.toContain("debugger");
    expect(manifest.permissions).not.toContain("webRequest");
    expect(manifest.optional_host_permissions).toEqual([
      "http://*/*",
      "https://*/*",
    ]);
    expect(manifest.action.default_popup).toBe("launcher.html");
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'none'",
    );
  });
});
