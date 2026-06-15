import { useState } from 'react';
import { MessageSquare, Loader2, Send, X, AlertCircle } from 'lucide-react';
import type { NodeType } from '@repo/code-graph-core';
import { postChat, type ChatResult } from '../../api/client';
import { TYPE_COLOR } from '../../lib/graph-style';

export type CitationInfo = { name: string; type: NodeType };

type ChatPanelProps = {
  onCite: (nodeId: string) => void;
  /** Resolve a citation node id to its display name + type (for friendly chips). */
  resolveCitation: (nodeId: string) => CitationInfo | null;
};

type Turn = { question: string; result: ChatResult | null; error: string | null };

const EXAMPLES = ['What does the indexer do?', 'Where is the graph rendered?'];

export const ChatPanel = ({
  onCite,
  resolveCitation,
}: ChatPanelProps): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async (q: string, turnIndex: number): Promise<void> => {
    setLoading(true);
    try {
      const result = await postChat(q);
      setTurns((t) =>
        t.map((turn, i) =>
          i === turnIndex ? { ...turn, result, error: null } : turn,
        ),
      );
    } catch (err) {
      // Never leave the turn spinning forever — record the error so the turn can
      // render an inline retry with the question preserved.
      const message =
        err instanceof Error ? err.message : 'Couldn’t reach the indexer';
      setTurns((t) =>
        t.map((turn, i) =>
          i === turnIndex ? { ...turn, result: null, error: message } : turn,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const ask = async (): Promise<void> => {
    const q = question.trim();
    if (!q || loading) return;
    setQuestion('');
    let nextIndex = 0;
    setTurns((t) => {
      nextIndex = t.length;
      return [...t, { question: q, result: null, error: null }];
    });
    await run(q, nextIndex);
  };

  const retry = (index: number): void => {
    if (loading) return;
    const turn = turns[index];
    if (!turn) return;
    setTurns((t) =>
      t.map((x, i) => (i === index ? { ...x, error: null } : x)),
    );
    void run(turn.question, index);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-5 right-5 flex items-center gap-2 rounded-full bg-accent/20 px-4 py-2 text-sm text-violet-100 ring-1 ring-accent/25 shadow-[var(--accent-glow)] backdrop-blur-xl hover:-translate-y-0.5 hover:bg-accent/30"
      >
        <MessageSquare className="h-4 w-4" />
        Ask the codebase
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Ask the codebase"
      className="animate-rise glass absolute bottom-5 right-5 flex h-[28rem] w-96 flex-col rounded-2xl"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium text-content">
          <MessageSquare className="h-4 w-4 text-accent" />
          Ask the codebase
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="rounded p-1 text-muted transition-colors hover:bg-content/10 hover:text-content"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            <MessageSquare className="mb-2 h-6 w-6 text-faint" aria-hidden="true" />
            <p className="mb-3 text-sm text-muted">
              Ask anything about this codebase
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-line-strong hover:text-content"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="space-y-1.5">
            <p className="text-sm font-medium text-content">{turn.question}</p>
            {turn.result ? (
              <ChatAnswer
                result={turn.result}
                onCite={onCite}
                resolveCitation={resolveCitation}
              />
            ) : turn.error ? (
              <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-2.5 text-xs text-(--status-error) ring-1 ring-rose-400/20">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p>Couldn’t reach the indexer.</p>
                  <button
                    type="button"
                    onClick={() => retry(i)}
                    disabled={loading}
                    className="mt-1 font-medium text-(--status-error) underline underline-offset-2 hover:text-content disabled:opacity-50"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : (
              <Loader2
                className="h-4 w-4 animate-spin text-muted"
                aria-label="Thinking…"
                role="status"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void ask();
          }}
          aria-label="Ask a question about the codebase"
          placeholder="Ask a question…"
          className="flex-1 rounded-lg border border-line bg-content/5 px-3 py-1.5 text-sm text-content outline-none placeholder:text-faint focus:border-accent/40"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={loading}
          aria-label="Send question"
          className="rounded bg-accent/20 p-1.5 text-violet-200 transition-colors hover:bg-accent/30 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

const ChatAnswer = ({
  result,
  onCite,
  resolveCitation,
}: {
  result: ChatResult;
  onCite: (id: string) => void;
  resolveCitation: (id: string) => CitationInfo | null;
}): React.ReactElement => (
  <div className="rounded-lg bg-surface p-3">
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
      {result.answer}
    </p>
    {result.citations.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {result.citations.slice(0, 5).map((id) => {
          const info = resolveCitation(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onCite(id)}
              title={id}
              className="flex max-w-full items-center gap-1.5 rounded bg-surface px-2 py-0.5 text-[11px] text-muted hover:text-content"
            >
              {info && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: TYPE_COLOR[info.type] }}
                  aria-hidden="true"
                />
              )}
              <span className="truncate font-mono">
                {info ? info.name : id.replace(/^[a-z]+:/, '')}
              </span>
            </button>
          );
        })}
      </div>
    )}
    {!result.usedLlm && (
      <p className="mt-1.5 text-[11px] text-muted">keyword match (no LLM)</p>
    )}
  </div>
);
