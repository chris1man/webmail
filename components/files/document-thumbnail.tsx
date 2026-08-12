"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { getFilePreviewKind } from "@/lib/file-preview";

type DocumentThumbnailProps = {
  name: string;
  type: string;
  getFileContent: () => Promise<{ blob: Blob; contentType: string }>;
  className?: string;
};

/** Renders only page one, keeping document attachment cards as lightweight as image cards. */
export function DocumentThumbnail({ name, type, getFileContent, className }: DocumentThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    let objectUrl: string | null = null;

    async function render() {
      try {
        const { blob, contentType } = await getFileContent();
        if (cancelled) return;
        let pdfBlob = blob;
        if (getFilePreviewKind(name, contentType || type || blob.type) === "office") {
          const form = new FormData();
          form.set("file", blob, name);
          const response = await fetch("/api/document-preview", { method: "POST", body: form });
          if (!response.ok) throw new Error("Document conversion failed");
          pdfBlob = await response.blob();
        }
        if (cancelled) return;

        objectUrl = URL.createObjectURL(new Blob([pdfBlob], { type: "application/pdf" }));
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ url: objectUrl });
        const document = await loadingTask.promise;
        const page = await document.getPage(1);
        if (cancelled || !canvasRef.current) return;

        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.25, 250 / base.width);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        await page.render({ canvas, viewport }).promise;
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void render();
    return () => {
      cancelled = true;
      void loadingTask?.destroy().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [getFileContent, name, type]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} className={status === "ready" ? "block bg-white" : "hidden"} />
      {status === "loading" && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {status === "error" && <FileText className="h-7 w-7 text-muted-foreground/60" />}
    </div>
  );
}
