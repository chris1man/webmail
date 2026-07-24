"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { formatFileSize } from "@/lib/utils";

export interface GalleryImage {
  id: string;
  name: string;
  size: number;
  url: string;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  initialIndex: number;
  onClose: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

export function ImageGallery({ images, initialIndex, onClose }: ImageGalleryProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const image = images[index];

  useEffect(() => {
    setIndex(initialIndex);
    setScale(1);
  }, [initialIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") setIndex((current) => (current - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") setIndex((current) => (current + 1) % images.length);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [images.length, onClose]);

  if (!image) return null;
  const changeImage = (direction: number) => {
    setIndex((current) => (current + direction + images.length) % images.length);
    setScale(1);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Image gallery" onClick={onClose}>
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between gap-4 text-white" onClick={(event) => event.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate font-medium">{image.name}</p>
          <p className="text-sm text-white/70">{formatFileSize(image.size)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums">{index + 1} / {images.length}</span>
          <button className="rounded-md p-2 hover:bg-white/15" onClick={onClose} aria-label="Close image gallery"><X className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="flex h-full w-full items-center justify-center overflow-hidden" onClick={(event) => event.stopPropagation()} onWheel={(event) => { event.preventDefault(); setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * (event.deltaY < 0 ? 1.15 : 0.85)))); }}>
        <img src={image.url} alt={image.name} className="max-h-full max-w-full select-none object-contain transition-transform" style={{ transform: `scale(${scale})` }} onDoubleClick={() => setScale(1)} draggable={false} />
      </div>

      {images.length > 1 && (
        <>
          <button className="absolute left-4 rounded-full bg-black/45 p-3 text-white hover:bg-black/70" onClick={(event) => { event.stopPropagation(); changeImage(-1); }} aria-label="Previous image"><ChevronLeft /></button>
          <button className="absolute right-4 rounded-full bg-black/45 p-3 text-white hover:bg-black/70" onClick={(event) => { event.stopPropagation(); changeImage(1); }} aria-label="Next image"><ChevronRight /></button>
        </>
      )}
      {scale !== 1 && <button className="absolute bottom-4 rounded-md bg-black/45 px-3 py-2 text-sm text-white hover:bg-black/70" onClick={(event) => { event.stopPropagation(); setScale(1); }}><RotateCcw className="mr-1 inline h-4 w-4" />100%</button>}
    </div>
  );
}
