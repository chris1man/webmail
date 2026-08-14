"use client";

import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import "pdfjs-dist/web/pdf_viewer.css";

/** Official PDF.js viewer: its own text and annotation layers provide exact selection and links. */
export function OfficialPdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ viewer: import("pdfjs-dist/web/pdf_viewer.mjs").PDFViewer; task: import("pdfjs-dist").PDFDocumentLoadingTask; bus: import("pdfjs-dist/web/pdf_viewer.mjs").EventBus } | null>(null);
  const [scale, setScale] = useState("page-width");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pdfjs, web] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/web/pdf_viewer.mjs")]);
      if (!containerRef.current || !viewerRef.current || cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const bus = new web.EventBus();
      const links = new web.PDFLinkService({ eventBus: bus, externalLinkTarget: 2, externalLinkRel: "noopener noreferrer" });
      const find = new web.PDFFindController({ linkService: links, eventBus: bus });
      const viewer = new web.PDFViewer({ container: containerRef.current, viewer: viewerRef.current, eventBus: bus, linkService: links, findController: find, textLayerMode: 2, annotationMode: 2 });
      links.setViewer(viewer);
      const task = pdfjs.getDocument({ url });
      const document = await task.promise;
      if (cancelled) { void task.destroy(); return; }
      links.setDocument(document);
      viewer.setDocument(document);
      apiRef.current = { viewer, task, bus };
      setPages(document.numPages);
      // PDFViewer creates page views asynchronously. Setting page-width only
      // after pagesinit is what triggers the first visible render.
      bus.on("pagesinit", () => { viewer.currentScaleValue = "page-width"; });
      bus.on("scalechanging", (event: { presetValue?: string; scale: number }) => setScale(event.presetValue || `${Math.round(event.scale * 100)}%`));
      bus.on("pagechanging", (event: { pageNumber: number }) => setPage(event.pageNumber));
      // Annotation rectangles can be marginally larger than their glyphs and
      // otherwise intercept a drag before the text layer can start selecting.
      // With their pointer events disabled in CSS, dispatch a real click only
      // when the user has not made a text selection.
      const openLinkOnClick = (event: MouseEvent) => {
        if (!event.isTrusted) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        const target = event.target instanceof Element ? event.target : null;
        const pageElement = target?.closest(".page");
        const link = Array.from(pageElement?.querySelectorAll<HTMLAnchorElement>(".linkAnnotation > a") ?? []).find((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        });
        if (link) link.click();
      };
      containerRef.current.addEventListener("click", openLinkOnClick);
      setLoading(false);
      return () => containerRef.current?.removeEventListener("click", openLinkOnClick);
    })().then((dispose) => {
      if (!dispose) return;
      const previousCleanup = cleanup;
      cleanup = () => { dispose(); previousCleanup?.(); };
    }).catch((reason) => { console.error("Official PDF.js viewer failed:", reason); setError(true); setLoading(false); });
    let cleanup: (() => void) | undefined;
    return () => { cancelled = true; cleanup?.(); apiRef.current?.viewer.cleanup(); void apiRef.current?.task.destroy(); apiRef.current = null; };
  }, [url]);
  const change = (next: string) => { const viewer = apiRef.current?.viewer; if (viewer) viewer.currentScaleValue = next; };
  const find = (previous = false) => apiRef.current?.bus.dispatch("find", { source: null, type: previous ? "findprevious" : "again", query, phraseSearch: true, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous });
  return <div className="flex h-full min-h-0 flex-col bg-neutral-200"><div className="flex flex-wrap items-center justify-center gap-1 border-b bg-background p-1"><Button variant="ghost" size="icon" onClick={() => change(String(Math.max(.5, (apiRef.current?.viewer.currentScale || 1) - .25)))}><ZoomOut className="h-4 w-4" /></Button><span className="min-w-14 text-center text-xs">{scale === "page-width" ? "По ширине" : scale}</span><Button variant="ghost" size="icon" onClick={() => change(String(Math.min(4, (apiRef.current?.viewer.currentScale || 1) + .25)))}><ZoomIn className="h-4 w-4" /></Button><Button variant="ghost" size="sm" onClick={() => change("page-width")}><Maximize2 className="mr-1 h-3.5 w-3.5" />По ширине</Button><span className="mx-1 text-xs">{page}/{pages || "–"}</span><Button variant="ghost" size="icon" onClick={() => { const v = apiRef.current?.viewer; if (v) v.currentPageNumber = Math.max(1, v.currentPageNumber - 1); }}><ChevronLeft className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => { const v = apiRef.current?.viewer; if (v) v.currentPageNumber = Math.min(pages, v.currentPageNumber + 1); }}><ChevronRight className="h-4 w-4" /></Button><div className="ml-1 flex items-center rounded border bg-background"><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") find(e.shiftKey); }} placeholder="Поиск" className="h-7 w-24 bg-transparent px-2 text-xs outline-none" /><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => find()}><Search className="h-3.5 w-3.5" /></Button></div></div><div className="relative min-h-0 flex-1"><div ref={containerRef} className="absolute inset-0 overflow-auto"><div ref={viewerRef} className="pdfViewer" /></div>{loading && <Loader2 className="absolute left-1/2 top-8 h-6 w-6 animate-spin" />}{error && <p className="p-6 text-sm text-destructive">Не удалось отрисовать документ.</p>}</div></div>;
}
