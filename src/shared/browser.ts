import type {
  BrowserMetadata,
  OperatingSystemMetadata,
} from "@testwitness/core";

const RESTRICTED_HOSTS = new Set([
  "chromewebstore.google.com",
  "chrome.google.com",
  "microsoftedge.microsoft.com",
]);

export function pageSupport(url: string | undefined): {
  supported: boolean;
  reason?: string;
} {
  if (!url)
    return {
      supported: false,
      reason:
        "Site access is not available. Click the TestWitness toolbar icon and choose Open TestWitness for this tab.",
    };

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        supported: false,
        reason:
          "Open a regular HTTP or HTTPS application page before starting TestWitness.",
      };
    }
    if (RESTRICTED_HOSTS.has(parsed.hostname.toLowerCase())) {
      return {
        supported: false,
        reason:
          "Browser extension stores cannot be instrumented by extensions.",
      };
    }
    return { supported: true };
  } catch {
    return { supported: false, reason: "The active tab URL is invalid." };
  }
}

export function urlOrigin(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

export function detectBrowser(userAgent: string): BrowserMetadata {
  const edge = /Edg\/([\d.]+)/u.exec(userAgent);
  if (edge) return { name: "Microsoft Edge", version: edge[1] ?? "" };
  const chrome = /(?:Chrome|CriOS)\/([\d.]+)/u.exec(userAgent);
  if (chrome) return { name: "Chrome", version: chrome[1] ?? "" };
  return { name: "Chromium browser", version: "" };
}

export function detectOperatingSystem(
  userAgent: string,
  platform: string,
): OperatingSystemMetadata {
  const windows = /Windows NT ([\d.]+)/u.exec(userAgent);
  if (windows) return { name: "Windows", version: windows[1] };
  const mac = /Mac OS X ([\d_]+)/u.exec(userAgent);
  if (mac) return { name: "macOS", version: mac[1]?.replaceAll("_", ".") };
  const android = /Android ([\d.]+)/u.exec(userAgent);
  if (android) return { name: "Android", version: android[1] };
  if (/Linux/u.test(userAgent)) return { name: "Linux" };
  return { name: platform || "Unknown" };
}
