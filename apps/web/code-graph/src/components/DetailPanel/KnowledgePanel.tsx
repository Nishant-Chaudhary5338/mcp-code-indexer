import { Sparkles, Loader2 } from 'lucide-react';
import type { NodeKnowledge } from '@repo/code-graph-core';

type KnowledgePanelProps = {
  knowledge: NodeKnowledge | null;
  loading: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
};

export const KnowledgePanel = ({
  knowledge,
  loading,
  canGenerate,
  onGenerate,
}: KnowledgePanelProps): React.ReactElement => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Asking Claude…
      </div>
    );
  }

  if (knowledge) {
    return (
      <div>
        <p className="text-sm leading-relaxed text-muted">
          {knowledge.summary}
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-wide text-muted">
          {knowledge.model}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm text-muted">
        No summary yet for this node.
      </p>
      {canGenerate && (
        <button
          type="button"
          onClick={onGenerate}
          className="flex items-center gap-1.5 rounded bg-violet-500/15 px-2.5 py-1 text-xs text-violet-300 transition-colors hover:bg-violet-500/25"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate AI summary
        </button>
      )}
    </div>
  );
};
