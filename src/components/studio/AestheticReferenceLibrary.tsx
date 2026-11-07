"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ReferenceFileDropTarget } from "./ReferenceFileDropTarget";
import { ReferenceSheetPreview } from "./ReferenceSheetPreview";
import { UploadControl } from "./UploadControl";
import { Surface } from "./ui";
import { uploadFileDirectlyToRustFs } from "./directUploadClient";
import { originalImageSha256, type AestheticReferenceAsset, type AestheticReferenceLibrary as Library } from "./aestheticReferences";

export function AestheticReferenceLibrary({ value, onChange, sections, shots }: {
  value: Library;
  onChange: Dispatch<SetStateAction<Library>>;
  sections: { id: string; label: string }[];
  shots: { id: string; label: string }[];
}) {
  const [message, setMessage] = useState("");
  const current = useRef(value);
  const pendingHashes = useRef(new Set<string>());
  const previews = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => { current.current = value; }, [value]);
  useEffect(() => {
    alive.current = true;
    const urls = previews.current;
    return () => { alive.current = false; for (const url of urls) URL.revokeObjectURL(url); };
  }, []);
  const update = (id: string, patch: Partial<AestheticReferenceAsset>) => onChange(library => library.assets.some(asset => asset.id === id)
    ? { ...library, assets: library.assets.map(asset => asset.id === id ? { ...asset, ...patch } : asset) } : library);

  async function add(files: File[]) {
    setMessage("");
    for (const file of files) {
      if (!alive.current) break;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !file.size || file.size > 32 * 1024 * 1024) { setMessage("Choose original PNG, JPEG or WebP images smaller than 32 MiB each."); continue; }
      let sha256: string;
      try { sha256 = await originalImageSha256(file); }
      catch { setMessage("Could not read the original image. Add it again."); continue; }
      if (!alive.current) break;
      if (pendingHashes.current.has(sha256) || current.current.assets.some(asset => asset.sha256 === sha256 && asset.storageStatus !== "failed")) {
        setMessage(`Skipped duplicate original: ${file.name}`); continue;
      }
      if (current.current.assets.length >= 128) { setMessage("This library holds up to 128 originals."); break; }
      pendingHashes.current.add(sha256);
      const previewUrl = URL.createObjectURL(file); previews.current.add(previewUrl);
      const asset: AestheticReferenceAsset = { id: `aesthetic-${crypto.randomUUID()}`, purpose: "shot", displayName: file.name.replace(/\.[^.]+$/, ""), fileName: file.name,
        sha256, guidance: "", scope: { kind: "project" }, previewUrl, storageStatus: "uploading", createdAt: new Date().toISOString() };
      onChange(library => ({ ...library, assets: [...library.assets.filter(existing => existing.sha256 !== sha256), asset] }));
      try {
        // Upload the original File; no canvas, resize, recompression or first-frame registration.
        const storage = await uploadFileDirectlyToRustFs(file, "media-uploads/aesthetic-references");
        const storageUrl = storage.publicUrl || storage.mediaUrl;
        const storagePath = storage.objectKey || storage.storagePath;
        if (!storage.bucket || !storagePath || !storageUrl) throw new Error("Original upload returned incomplete storage details.");
        update(asset.id, { storageBucket: storage.bucket, storagePath, storageUrl, previewUrl: storageUrl, storageStatus: "uploaded" });
        URL.revokeObjectURL(previewUrl); previews.current.delete(previewUrl);
      } catch (error) { update(asset.id, { storageStatus: "failed", storageError: error instanceof Error ? error.message : "Upload failed. Add the original again to retry." }); }
      finally { pendingHashes.current.delete(sha256); }
    }
  }

  return <Surface aria-label="Shot and style refs">
    <ReferenceFileDropTarget label="Shot and style refs" multiple onFiles={add}>
      {(acceptFiles, disabled) => <>
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-sm font-semibold">Shot and style refs</h3>
            <p className="mt-1 text-xs text-fg-3">Keep original frames for composition, camera, lighting and color. Character sheets control identity and wardrobe; environment sheets control the location.</p>
            <p className="mt-1 text-xs text-fg-3">Scope controls where an image is available. Choose up to three explicitly in Create one shot; storing an image never adds it to every prompt.</p></div>
          <UploadControl accept="image/png,image/jpeg,image/webp" multiple title="" detail="" actionLabel="Add originals" variant="button" disabled={disabled} onFiles={acceptFiles} />
        </div>
        {!value.assets.length ? <p className="mt-3 rounded-md border border-dashed border-line p-5 text-center text-xs text-fg-3">Drop shot or style images here</p> : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{value.assets.map(asset => <article key={asset.id} className="rounded-md border border-line p-2">
          <div className="aspect-video overflow-hidden bg-ink-0"><ReferenceSheetPreview src={asset.previewUrl} name={asset.displayName} /></div>
          <label className="mt-2 block text-xs text-fg-3">Name<input aria-label={`Name ${asset.fileName}`} value={asset.displayName} maxLength={120} onChange={event => update(asset.id, { displayName: event.target.value })} className="mt-1 w-full rounded-md border border-line bg-ink-1 p-2 text-fg-1" /></label>
          <label className="mt-2 block text-xs text-fg-3">Purpose<select aria-label={`Purpose ${asset.fileName}`} value={asset.purpose} onChange={event => update(asset.id, { purpose: event.target.value as "shot" | "style" })} className="mt-1 w-full rounded-md border border-line bg-ink-1 p-2 text-fg-1"><option value="shot">Shot · framing and blocking</option><option value="style">Style · light, lens and color</option></select></label>
          <label className="mt-2 block text-xs text-fg-3">Available for<select aria-label={`Scope ${asset.fileName}`} value={asset.scope.kind === "project" ? "project" : asset.scope.kind === "section" ? `section:${asset.scope.sectionId}` : `shot:${asset.scope.timelineItemId}`} onChange={event => {
            const chosen = event.target.value; update(asset.id, { scope: chosen.startsWith("section:") ? { kind: "section", sectionId: chosen.slice(8) } : chosen.startsWith("shot:") ? { kind: "shot", timelineItemId: chosen.slice(5) } : { kind: "project" } });
          }} className="mt-1 w-full rounded-md border border-line bg-ink-1 p-2 text-fg-1"><option value="project">Project library</option>{sections.map(section => <option key={section.id} value={`section:${section.id}`}>Section · {section.label}</option>)}{shots.map(shot => <option key={shot.id} value={`shot:${shot.id}`}>Shot · {shot.label}</option>)}</select></label>
          <label className="mt-2 block text-xs text-fg-3">Use for<textarea aria-label={`Guidance ${asset.fileName}`} rows={2} maxLength={500} value={asset.guidance} placeholder="e.g. low camera, amber practicals" onChange={event => update(asset.id, { guidance: event.target.value })} className="mt-1 w-full rounded-md border border-line bg-ink-1 p-2 text-fg-1" /></label>
          <p className="mt-2 text-xs text-fg-3">{asset.storageStatus}</p>{asset.storageError ? <p role="alert" className="text-xs text-danger">{asset.storageError}</p> : null}
          <button type="button" className="mt-2 text-xs text-fg-3 underline" onClick={() => onChange(library => ({ ...library, assets: library.assets.filter(candidate => candidate.id !== asset.id), shots: Object.fromEntries(Object.entries(library.shots).map(([id, refs]) => [id, refs.filter(ref => ref !== asset.id)])) }))}>Remove from library</button>
        </article>)}</div>
        {message ? <p role="status" className="mt-2 text-xs text-fg-2">{message}</p> : null}
      </>}
    </ReferenceFileDropTarget>
  </Surface>;
}
