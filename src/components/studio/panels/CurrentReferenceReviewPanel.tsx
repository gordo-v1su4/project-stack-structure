"use client";

import { useEffect, useRef, useState } from "react";
import { generatedAssetDraftIdentityBlockReason, type GeneratedStudioAsset } from "../generatedAssets";
import { Button, Surface } from "../ui";

type Props = {
  migrated: boolean;
  assets: GeneratedStudioAsset[];
  disabled: boolean;
  onMigrate: () => Promise<void>;
  onAssess?: () => Promise<void>;
};

export function CurrentReferenceReviewPanel({ migrated, assets, disabled, onMigrate, onAssess }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const affected = assets.filter(asset => asset.currentReferenceIdentity?.required);
  const blocked = affected.filter(asset => generatedAssetDraftIdentityBlockReason(asset));

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await action();
      if (mounted.current) setMessage(success);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not check the updated references.");
    } finally { if (mounted.current) setBusy(false); }
  }

  return <Surface aria-label="Updated character references">
    <h3 className="text-sm font-semibold">Updated character references</h3>
    <p className="mt-1 text-xs text-fg-3">Keep the existing cuts when adopting an updated character sheet. Affected takes need a new similarity check and a fresh review of the complete cut.</p>
    {migrated ? <p className="mt-2 text-xs text-fg-2">
      {affected.length} takes in this cut use an earlier sheet · {blocked.length} await a passing check. Existing cuts remain selected.
    </p> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {!migrated ? <Button disabled={disabled || busy} onClick={() => void run(onMigrate, "Updated references saved. Check affected takes before reviewing the complete cut.")}>Use updated references</Button>
        : onAssess ? <Button disabled={disabled || busy || !affected.length} onClick={() => void run(onAssess, "Current-reference checks saved. Review the results and the complete cut before accepting it.")}>{busy ? "Checking takes in this cut…" : "Check takes in this cut"}</Button> : null}
    </div>
    {message ? <p role="status" className="mt-2 text-xs text-fg-2">{message}</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
  </Surface>;
}
