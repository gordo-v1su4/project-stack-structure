"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";

type ReferenceFileDropTargetProps = {
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  onFiles: (files: File[]) => void | Promise<void>;
  children: (onFiles: (files: File[]) => Promise<void>, disabled: boolean) => ReactNode;
};

/** Own the drop in capture so nested upload controls cannot upload it twice. */
export function ReferenceFileDropTarget({
  label,
  multiple = false,
  disabled = false,
  className = "",
  onFiles,
  children,
}: ReferenceFileDropTargetProps) {
  const hintId = useId();
  const dragDepth = useRef(0);
  const submitting = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unavailable = disabled || isSubmitting;

  async function acceptFiles(files: File[]) {
    if (disabled || submitting.current || !files.length) return;
    if (files.some((file) => !file.type.startsWith("image/"))) {
      setError("Choose image files only. No files were uploaded.");
      return;
    }
    if (!multiple && files.length > 1) {
      setError("Choose one reference image at a time. No files were uploaded.");
      return;
    }
    setError(null);
    submitting.current = true;
    setIsSubmitting(true);
    try {
      await onFiles(files);
    } catch {
      setError("Reference upload failed. Try choosing the image again.");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  function hasFiles(event: DragEvent<HTMLDivElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    <div
      role="group"
      aria-label={`${label} upload area`}
      aria-describedby={hintId}
      aria-disabled={unavailable}
      onDragEnterCapture={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current += 1;
        if (!unavailable) setIsDragging(true);
      }}
      onDragOverCapture={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = unavailable ? "none" : "copy";
      }}
      onDragLeaveCapture={(event) => {
        if (!hasFiles(event)) return;
        event.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setIsDragging(false);
      }}
      onDropCapture={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setIsDragging(false);
        if (!unavailable) void acceptFiles(Array.from(event.dataTransfer.files));
      }}
      className={`${className} transition-colors ${isDragging && !unavailable ? "ring-2 ring-accent bg-accent-tint" : ""}`}
    >
      {children(acceptFiles, unavailable)}
      <p id={hintId} aria-live="polite" className={`mt-2 text-[9px] leading-4 ${isDragging && !unavailable ? "text-accent" : "text-fg-3"}`}>
        {isSubmitting ? "Uploading reference images…" : isDragging && !unavailable ? `Drop ${multiple ? "images" : "one image"} here` : `Drop ${multiple ? "images" : "one image"} anywhere here, or use the upload button.`}
      </p>
      {error ? <p role="alert" className="mt-1 text-[9px] leading-4 text-danger">{error}</p> : null}
    </div>
  );
}
