import { useEffect, useState } from 'react';
import { fetchSource } from '../../api/client';

type SourceState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; code: string };

/**
 * Self-contained source preview: given a node id, it fetches that node's source
 * text on mount (and whenever the id changes) and renders it in a scrollable
 * code block. The result is tagged with the id it belongs to, so a fast
 * click-through never paints an earlier node's source over a newer one — and the
 * loading state is *derived* (not set synchronously in the effect).
 */
export const SourcePreview = ({
  nodeId,
}: {
  nodeId: string;
}): React.ReactElement => {
  const [loaded, setLoaded] = useState<{ id: string; state: SourceState } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void fetchSource(nodeId).then((result) => {
      if (cancelled) return;
      const next: SourceState =
        !result || result.code.trim().length === 0
          ? { status: 'empty' }
          : { status: 'ready', code: result.code };
      setLoaded({ id: nodeId, state: next });
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  // Until a result for the *current* id arrives, we're loading.
  const state: SourceState =
    loaded && loaded.id === nodeId ? loaded.state : { status: 'loading' };

  if (state.status === 'loading') {
    return <p className="text-[12px] text-faint">Loading source…</p>;
  }

  if (state.status === 'empty') {
    return <p className="text-[12px] text-faint">No source available.</p>;
  }

  return (
    <pre className="max-h-72 overflow-auto whitespace-pre rounded-md bg-surface p-3 font-mono text-[12px] leading-relaxed text-muted ring-1 ring-line">
      {state.code}
    </pre>
  );
};
