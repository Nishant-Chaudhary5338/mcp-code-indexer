import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, Image } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';

const BTN =
  'flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-content/5 text-muted backdrop-blur-xl hover:bg-content/10 hover:text-content';

const ITEM =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:bg-content/10 hover:text-content disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** Push a Blob/data-url to the browser as a file download via a throwaway anchor. */
const downloadHref = (href: string, filename: string): void => {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/**
 * Export control: dumps the in-memory graph snapshot as JSON, or snapshots the
 * force-graph canvas as a PNG. Self-contained — reads `snapshot` from the store,
 * so the parent only has to render it.
 */
export const ExportMenu = (): React.ReactElement => {
  const snapshot = useGraphStore((s) => s.snapshot);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const exportJson = (): void => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    downloadHref(url, 'code-graph.json');
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const exportPng = (): void => {
    const canvas = document.querySelector('main canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    // WebGL (3D) canvases without preserveDrawingBuffer may yield a blank frame;
    // the 2D renderer exports cleanly. We download whatever the canvas gives.
    let url: string;
    try {
      url = canvas.toDataURL('image/png');
    } catch {
      return;
    }
    downloadHref(url, 'code-graph.png');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-44 rounded-lg border border-line bg-surface p-1 shadow-xl backdrop-blur-xl">
          <button type="button" onClick={exportJson} disabled={!snapshot} className={ITEM}>
            <FileJson className="h-3.5 w-3.5" />
            Export graph JSON
          </button>
          <button type="button" onClick={exportPng} className={ITEM}>
            <Image className="h-3.5 w-3.5" aria-hidden />
            Export PNG
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Export graph"
        aria-haspopup="menu"
        aria-expanded={open}
        className={BTN}
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
};
