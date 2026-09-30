export type ExtensionErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_STATE"
  | "SESSION_ALREADY_ACTIVE"
  | "NO_ACTIVE_SESSION"
  | "TAB_NOT_FOUND"
  | "TARGET_TAB_INACTIVE"
  | "UNSUPPORTED_PAGE"
  | "HOST_PERMISSION_REQUIRED"
  | "INSTRUMENTATION_FAILED"
  | "SCREENSHOT_FAILED"
  | "VIDEO_FAILED"
  | "STORAGE_FAILED"
  | "EXPORT_FAILED";

export class ExtensionError extends Error {
  public readonly code: ExtensionErrorCode;
  public readonly recoverable: boolean;

  public constructor(
    code: ExtensionErrorCode,
    message: string,
    recoverable = true,
  ) {
    super(message);
    this.name = "ExtensionError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export interface ExtensionErrorPayload {
  code: ExtensionErrorCode;
  message: string;
  recoverable: boolean;
}

export function toExtensionError(
  error: unknown,
  fallbackCode: ExtensionErrorCode,
): ExtensionError {
  if (error instanceof ExtensionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ExtensionError(
    fallbackCode,
    message || "An unexpected extension error occurred.",
  );
}
