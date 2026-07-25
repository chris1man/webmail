"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import { formatFileSize } from "@/lib/utils";

export interface GalleryImage {
  id: string;
  name: string;
  size: number;
  // Empty when the image should be fetched lazily through loadImage.
  url: string;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  initialIndex: number;
  loadImage?: (image: GalleryImage) => Promise<string | null>;
  onClose: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

export function ImageGallery({ images, initialIndex, loadImage, onClose }: ImageGalleryProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const urlsRef = useRef<Record<string, string>>({});
  const loadsRef = useRef(new Map<string, Promise<string | null>>());
  const image = images[index];

  const ensureImage = useCallback(async (targetIndex: number): Promise<string | null> => {
    const target = images[targetIndex];
    if (!target) return null;
    if (urlsRef.current[target.id]) return urlsRef.current[target.id];
    if (target.url) {
      urlsRef.current = { ...urlsRef.current, [target.id]: target.url };
      setUrls(urlsRef.current);
      return target.url;
    }
    if (!loadImage) return null;

    const pending = loadsRef.current.get(target.id);
    if (pending) return pending;

    const request = loadImage(target).then((url) => {
      if (url) {
        urlsRef.current = { ...urlsRef.current, [target.id]: url };
        setUrls(urlsRef.current);
      }
      return url;
    }).finally(() => {
      loadsRef.current.delete(target.id);
    });
    loadsRef.current.set(target.id, request);
    return request;
  }, [images, loadImage]);

  useEffect(() => {
    setIndex(initialIndex);
    setScale(1);
  }, [initialIndex]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingImage(true);
    setLoadFailed(false);

    // The selected image is always fetched first. Only after it is available
    // do we warm the immediately adjacent images for a smooth next/previous.
    void ensureImage(index).then((url) => {
      if (cancelled) return;
      if (!url) {
        setLoadFailed(true);
        setIsLoadingImage(false);
        return;
      }
      const neighbors = [
        (index - 1 + images.length) % images.length,
        (index + 1) % images.length,
      ].filter((value, position, all) => value !== index && all.indexOf(value) === position);
      void Promise.all(neighbors.map((neighbor) => ensureImage(neighbor)));
    });

    return () => { cancelled = true; };
  }, [ensureImage, images.length, index]);

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
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between gap-4 text-white" onClick={(event) => event.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate font-medium">{image.name}</p>
          <p className="text-sm text-white/70">{formatFileSize(image.size)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums">{index + 1} / {images.length}</span>
          <button
            className="rounded-md p-2 hover:bg-white/15"
            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
            aria-label="Close image gallery"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative flex h-full w-full items-center justify-center overflow-hidden" onClick={(event) => event.stopPropagation()} onWheel={(event) => { event.preventDefault(); setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * (event.deltaY < 0 ? 1.15 : 0.85)))); }}>
        {(isLoadingImage || !urls[image.id]) && !loadFailed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-white/80">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Loading image…</span>
          </div>
        )}
        {loadFailed ? (
          <p className="text-sm text-white/80">Could not load this image.</p>
        ) : urls[image.id] ? (
          <img src={urls[image.id]} alt={image.name} className="max-h-full max-w-full select-none object-contain transition-transform" style={{ transform: `scale(${scale})` }} onLoad={() => setIsLoadingImage(false)} onError={() => { setLoadFailed(true); setIsLoadingImage(false); }} onDoubleClick={() => setScale(1)} draggable={false} />
        ) : null}
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
