/** Persisted request-key generation fences the owner-scoped Trigger namespace.
 * Never upgrade a legacy key: its original dispatch may have lost its ACK. */
export const OWNED_FINAL_EXPORT_PREFIX = "final-export-owned-v1-";
export const OWNED_CAPTURE_EXPORT_PREFIX = "final-export-webgpu-owned-v1-";
export const EXPORT_DISPATCH_UPGRADE_MESSAGE = "The app was updated. Reload it before exporting. If an earlier export is unresolved, recover that request before starting another.";

export function isOwnedExportRequestKey(value: unknown, kind: "final" | "capture"): value is string {
  const prefix = kind === "final" ? OWNED_FINAL_EXPORT_PREFIX : OWNED_CAPTURE_EXPORT_PREFIX;
  // Same total bound as normalizeFinalExportIntent: final-export- plus 100 characters.
  return typeof value === "string" && value.length <= 113 && value.startsWith(prefix)
    && /^[a-zA-Z0-9_-]+$/.test(value.slice(prefix.length));
}
