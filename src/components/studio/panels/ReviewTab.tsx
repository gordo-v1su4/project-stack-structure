"use client";

import { ReviewWorkspace } from "@/review/components/layout/review-workspace";
import type { UploadedVideoSource } from "../types";

/**
 * Pre-edit review stage. Wraps the ported DAILIES review workspace. Approved
 * clips flow up to StudioApp's shared video source list for the editing tabs.
 */
export function ReviewTab({
  onApprovedSourcesChange,
}: {
  onApprovedSourcesChange?: (sources: UploadedVideoSource[]) => void;
}) {
  return <ReviewWorkspace onApprovedSourcesChange={onApprovedSourcesChange} />;
}
