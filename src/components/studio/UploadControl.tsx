"use client";

import { useId, useState } from "react";

type UploadControlProps = {
  accept: string;
  title: string;
  detail: string;
  actionLabel: string;
  multiple?: boolean;
  disabled?: boolean;
  isProcessing?: boolean;
  processingProgress?: number;
  status?: string;
  error?: string | null;
  variant?: "surface" | "button";
  onFiles: (files: File[]) => void | Promise<void>;
};

export function UploadControl({
  accept,
  title,
  detail,
  actionLabel,
  multiple = false,
  disabled = false,
  isProcessing = false,
  processingProgress = 0,
  status,
  error,
  variant = "surface",
  onFiles,
}: UploadControlProps) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const normalizedProgress = Math.max(0, Math.min(100, processingProgress));
  const activeSegments = Math.max(1, Math.round((normalizedProgress / 100) * 14));

  function handleFiles(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    void onFiles(files);
  }

  if (variant === "button") {
    return (
      <label
        htmlFor={inputId}
        className={`text-[10px] uppercase tracking-[0.12em] px-2 py-[2px] border rounded-[2px] cursor-pointer ${
          disabled ? "border-[#404040] text-[#707070]" : "border-[#1e1e1e] text-[#a0a0a0] hover:border-[#2f2f2f]"
        }`}
      >
        {actionLabel}
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
    );
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
      className={`block border rounded-[2px] px-4 py-8 text-center cursor-pointer transition-colors ${
        disabled
          ? "border-[#2a2a2a] bg-[#0b0b0b] text-[#5a5a5a]"
          : isDragging
            ? "border-[#e05c00] bg-[#140c06]"
            : "border-dashed border-[#2b2b2b] bg-[#0a0a0a] hover:border-[#3a3a3a]"
      }`}
    >
      <div className="text-[13px] text-[#b0b0b0] mb-2">{title}</div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#555]">{detail}</div>
      <div className="mt-4 inline-flex min-w-[184px] flex-col items-center justify-center rounded-[2px] border border-[#1f1f1f] bg-[#101010] px-3 py-[6px]">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[#c7c7c7]">{actionLabel}</div>
        {isProcessing ? (
          <div className="mt-3 flex w-full items-end gap-[3px] px-[2px]">
            {Array.from({ length: 14 }, (_, index) => (
              <div
                key={index}
                className="h-4 flex-1 transition-all duration-300"
                style={{
                  background:
                    index < activeSegments
                      ? progressSegmentColor(index, 14)
                      : "rgba(58,58,58,0.55)",
                  opacity: index < activeSegments ? 1 : 0.4,
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
      {status ? <div className="mt-3 text-[10px] font-mono text-[#727272]">{status}</div> : null}
      {error ? <div className="mt-2 text-[10px] text-[#b96c43]">{error}</div> : null}
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function progressSegmentColor(index: number, totalSegments: number) {
  const ratio = totalSegments <= 1 ? 1 : index / (totalSegments - 1);
  const start = { r: 224, g: 92, b: 0 };
  const end = { r: 248, g: 190, b: 74 };

  const r = Math.round(start.r + (end.r - start.r) * ratio);
  const g = Math.round(start.g + (end.g - start.g) * ratio);
  const b = Math.round(start.b + (end.b - start.b) * ratio);

  return `rgb(${r} ${g} ${b})`;
}
