import { normalizeMediaPath } from "./mediaGateway";

export type DurableCaptionReference = {
  name: string;
  role: "primary" | "secondary" | "environment";
  bucket: string;
  objectKey: string;
  fileName?: string;
};

const CAPTION_REFERENCE_ROLE_ORDER: DurableCaptionReference["role"][] = ["primary", "secondary", "environment"];

/** Smart captions support two character sheets plus one named environment reference. */
export function normalizeCaptionReferencesForGateway(
  references: DurableCaptionReference[] | undefined,
): DurableCaptionReference[] {
  if (!references?.length) return [];
  const normalized = [
    ...references.filter((reference) => reference.role === "primary").slice(0, 1),
    ...references.filter((reference) => reference.role === "secondary").slice(0, 1),
    ...references.filter((reference) => reference.role === "environment").slice(0, 1),
  ];
  return normalized.sort(
    (left, right) => CAPTION_REFERENCE_ROLE_ORDER.indexOf(left.role) - CAPTION_REFERENCE_ROLE_ORDER.indexOf(right.role),
  );
}

export function parseDurableCaptionReferences(value: unknown, expectedBucket: string): DurableCaptionReference[] {
  let parsed = value;
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error("Caption references must be valid JSON.");
    }
  }
  if (parsed == null) return [];
  if (!Array.isArray(parsed) || parsed.length > 3) {
    throw new Error("Caption references must contain at most two character images and one environment image.");
  }

  return parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Caption reference entries must be objects.");
    }
    const record = item as Record<string, unknown>;
    const name = boundedString(record.name, 120);
    const bucket = boundedString(record.bucket, 160);
    const objectKey = normalizeMediaPath(boundedString(record.objectKey, 2_000));
    const fileName = boundedString(record.fileName, 240, false);
    const role = record.role === "secondary"
      ? "secondary"
      : record.role === "primary"
        ? "primary"
        : record.role === "environment"
          ? "environment"
          : null;
    if (!name || !bucket || !objectKey || !role || bucket !== expectedBucket) {
      throw new Error("Caption reference contains an invalid name, role, bucket, or object key.");
    }
    return { name, role, bucket, objectKey, ...(fileName ? { fileName } : {}) };
  });
}

function boundedString(value: unknown, maxLength: number): string;
function boundedString(value: unknown, maxLength: number, required: false): string | undefined;
function boundedString(value: unknown, maxLength: number, required = true) {
  if (typeof value !== "string") return required ? "" : undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || (required ? "" : undefined);
}
