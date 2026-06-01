"use client";

import { useCallback, useState } from "react";

export function useDropZone(onFiles: (files: File[]) => void) {
  const [isOver, setIsOver] = useState(false);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsOver(false);
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type.startsWith("video/") || f.type.startsWith("image/") || /\.(mov|mp4|webm|mkv|exr)$/i.test(f.name)
      );
      if (files.length) onFiles(files);
    },
    [onFiles]
  );

  return { isOver, dropProps: { onDragOver, onDragLeave, onDrop } };
}
