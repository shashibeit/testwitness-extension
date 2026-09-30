import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distributionDirectory = path.join(projectRoot, "dist");
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(path.join(distributionDirectory, "manifest.json"), "utf8"),
);

function invariant(condition, message) {
  if (!condition) throw new Error(`Invalid extension build: ${message}`);
}

invariant(manifest.manifest_version === 3, "manifest_version must be 3");
invariant(
  manifest.version === packageJson.version,
  "manifest version must match package version",
);
invariant(
  manifest.background?.service_worker === "service-worker.js",
  "service worker is missing",
);
invariant(
  manifest.side_panel?.default_path === "sidepanel.html",
  "side panel is missing",
);
invariant(
  manifest.action?.default_popup === "launcher.html",
  "privacy launcher popup is missing",
);
invariant(
  !manifest.permissions.includes("debugger"),
  "Standard edition cannot request debugger",
);
invariant(
  !manifest.permissions.includes("webRequest"),
  "Standard edition cannot request webRequest",
);
invariant(
  !manifest.host_permissions,
  "mandatory host permissions are not allowed",
);

const referencedFiles = new Set([
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.action.default_popup,
  "offscreen.html",
  "content-script.js",
  "page-bridge.js",
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
]);
for (const file of referencedFiles) {
  await access(path.join(distributionDirectory, file));
}

for (const htmlFile of ["launcher.html", "sidepanel.html", "offscreen.html"]) {
  const html = await readFile(
    path.join(distributionDirectory, htmlFile),
    "utf8",
  );
  invariant(
    !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/iu.test(html),
    `${htmlFile} contains an inline script that violates extension CSP`,
  );
}

console.log(
  "Validated Manifest V3 permissions, CSP, and packaged resource paths.",
);
