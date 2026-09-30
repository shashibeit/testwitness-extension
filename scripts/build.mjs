import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(projectRoot, "dist");
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);
const define = {
  __TEST_WITNESS_EXTENSION_VERSION__: JSON.stringify(packageJson.version),
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  configFile: false,
  root: projectRoot,
  define,
  build: {
    target: "chrome116",
    outDir: outputDirectory,
    emptyOutDir: false,
    minify: "oxc",
    sourcemap: true,
    rollupOptions: {
      input: {
        launcher: path.join(projectRoot, "launcher.html"),
        sidepanel: path.join(projectRoot, "sidepanel.html"),
        offscreen: path.join(projectRoot, "offscreen.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

const scriptEntries = [
  [
    "service-worker",
    "src/background/service-worker.ts",
    "TestWitnessServiceWorker",
  ],
  [
    "content-script",
    "src/content/content-script.ts",
    "TestWitnessContentScript",
  ],
  ["page-bridge", "src/page/page-bridge.ts", "TestWitnessPageBridge"],
];

for (const [fileName, entry, globalName] of scriptEntries) {
  await build({
    configFile: false,
    root: projectRoot,
    define,
    build: {
      target: "chrome116",
      outDir: outputDirectory,
      emptyOutDir: false,
      minify: "oxc",
      sourcemap: true,
      lib: {
        entry: path.join(projectRoot, entry),
        name: globalName,
        formats: ["iife"],
        fileName: () => `${fileName}.js`,
      },
    },
  });
}

await copyFile(
  path.join(projectRoot, "src/manifest.json"),
  path.join(outputDirectory, "manifest.json"),
);

console.log(
  `Built TestWitness Extension Standard ${packageJson.version} in ${outputDirectory}`,
);
