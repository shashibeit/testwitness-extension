import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";

import { afterEach } from "vitest";

Object.defineProperty(globalThis, "Blob", {
  configurable: true,
  value: NodeBlob,
  writable: true,
});

afterEach(() => {
  document.body.replaceChildren();
});
