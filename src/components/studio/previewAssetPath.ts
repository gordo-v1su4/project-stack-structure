import os from "node:os";
import path from "node:path";

const PREVIEW_OUTPUT_DIR_NAME = "project-stack-structure-previews";

export function getDefaultPreviewOutputDir() {
  return path.join(os.tmpdir(), PREVIEW_OUTPUT_DIR_NAME);
}

export function resolveAllowedPreviewAssetPath(assetKey: string) {
  const normalizedAssetKey = assetKey.trim();
  if (!normalizedAssetKey) return null;

  const allowedRoot = path.resolve(getDefaultPreviewOutputDir());
  const resolvedAssetPath = path.resolve(normalizedAssetKey);
  const isAllowedPath =
    resolvedAssetPath === allowedRoot || resolvedAssetPath.startsWith(`${allowedRoot}${path.sep}`);

  return isAllowedPath ? resolvedAssetPath : null;
}
