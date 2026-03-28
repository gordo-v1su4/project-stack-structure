"use client";

import { useId, useState } from "react";

type UploadControlProps = {
  accept: string;
  title: string;
  detail: string;
  actionLabel: string;
  multiple?: boolean;
  disabled?: boolean;
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
  status,
  error,
  variant = "surface",
  onFiles,
}: UploadControlProps) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

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
      <div className="mt-4 inline-flex items-center justify-center rounded-[2px] border border-[#1f1f1f] bg-[#101010] px-3 py-[6px] text-[10px] uppercase tracking-[0.14em] text-[#c7c7c7]">
        {actionLabel}
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
