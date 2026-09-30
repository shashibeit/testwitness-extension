export function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;

  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const random = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${Date.now().toString(36)}-${random || Math.random().toString(36).slice(2)}`;
}

export function createSessionId(): string {
  return createId("tw");
}
