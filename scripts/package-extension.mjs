import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distributionDirectory = path.join(projectRoot, "dist");
const artifactDirectory = path.join(projectRoot, "artifacts");
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);

async function addDirectory(zip, directory, prefix = "") {
  const entries = await readdir(directory);
  for (const entry of entries.sort()) {
    if (entry.endsWith(".map")) continue;
    const absolutePath = path.join(directory, entry);
    const archivePath = prefix ? `${prefix}/${entry}` : entry;
    const entryStat = await stat(absolutePath);
    if (entryStat.isDirectory())
      await addDirectory(zip, absolutePath, archivePath);
    else
      zip.file(archivePath, await readFile(absolutePath), {
        date: new Date("2000-01-01T00:00:00Z"),
      });
  }
}

await mkdir(artifactDirectory, { recursive: true });

for (const browser of ["chrome", "edge"]) {
  const zip = new JSZip();
  await addDirectory(zip, distributionDirectory);
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS",
  });
  const fileName = `testwitness-extension-standard-${browser}-${packageJson.version}.zip`;
  await writeFile(path.join(artifactDirectory, fileName), bytes);
  console.log(`Created artifacts/${fileName}`);
}
