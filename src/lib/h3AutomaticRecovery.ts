/** Retries belong to the original Trigger run, never a new creative intent. */
export const H3_AUTOMATIC_RECOVERY_ATTEMPTS = 8;

/** Only explicitly identified, replay-safe reads may opt into automatic recovery. */
export class H3RecoverableReadError extends Error {}

export function isH3RecoverableReadError(error: unknown): boolean {
  return error instanceof H3RecoverableReadError;
}

export function isTransientH3ReadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const transport = error as Error & { code?: string; $metadata?: { httpStatusCode?: number } };
  return ["TimeoutError", "AbortError"].includes(error.name)
    || ["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"].includes(transport.code ?? "")
    || (transport.$metadata?.httpStatusCode ?? 0) >= 500;
}
