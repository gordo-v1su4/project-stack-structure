import contract from "../../config/studio-metadata-privacy.json";

// Keep this contract byte-identical to the Media API copy (V1S-450).
const patterns = contract.patterns.map((pattern) => new RegExp(
  "^" + pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
));

export function isCanonicalStudioMetadata(bucket: string, objectKey: string): boolean {
  return bucket === contract.bucket && patterns.some((pattern) => pattern.test(objectKey));
}

export function isSafeStudioObjectKey(objectKey: string): boolean {
  return !/[\\\u0000-\u001f\u007f]/.test(objectKey)
    && !objectKey.split("/").some((segment) => segment === "." || segment === "..");
}
