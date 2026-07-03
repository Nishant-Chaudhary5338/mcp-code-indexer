import { useEffect, useState } from 'react';
import { Boxes, Github, Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';
import type { RepoSummary } from '../../api/client';

/** ready → building (cloning/indexing) → error; live/curated before clones. */
const ORIGIN_RANK: Record<RepoSummary['origin'], number> = {
  live: 0,
  curated: 1,
  github: 2,
};
const STATUS_RANK: Record<RepoSummary['status'], number> = {
  ready: 0,
  indexing: 1,
  cloning: 1,
  error: 2,
};
const sortRepos = (a: RepoSummary, b: RepoSummary): number =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
  ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] ||
  a.label.localeCompare(b.label);

export const RepoPicker = (): React.ReactElement => {
  const repos = useGraphStore((s) => s.repos);
  const loadRepos = useGraphStore((s) => s.loadRepos);
  const openRepo = useGraphStore((s) => s.openRepo);
  const submitGithubUrl = useGraphStore((s) => s.submitGithubUrl);

  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  // Curated repos pre-warm on the server; poll the list while any is still
  // cloning/indexing so its card flips to "ready" without a manual refresh.
  const anyBuilding = repos.some(
    (r) => r.status === 'cloning' || r.status === 'indexing',
  );
  useEffect(() => {
    if (!anyBuilding) return;
    const timer = setInterval(() => void loadRepos(), 2000);
    return () => clearInterval(timer);
  }, [anyBuilding, loadRepos]);

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const summary = await submitGithubUrl(trimmed);
      if (summary.status === 'ready') {
        await openRepo(summary.id);
        return;
      }
      setError(summary.error ?? 'Indexing failed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repo.');
    } finally {
      setSubmitting(false);
    }
  };

  const sorted = [...repos].sort(sortRepos);

  return (
    <div className="relative flex h-full flex-col items-center overflow-y-auto px-6 py-16">
      {/* Atmospheric backdrop — decorative only; it must sit BEHIND and never
          capture pointer events (the .graph-vignette class is inset-0 absolute). */}
      <div className="graph-vignette" aria-hidden="true" />
      <div className="animate-rise relative z-10 w-full max-w-3xl">
        <span className="flex items-center gap-2 text-accent">
          <Boxes className="h-6 w-6" />
          <span className="text-sm font-semibold tracking-tight">Code Graph</span>
        </span>
        <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight text-content sm:text-5xl">
          Explore any TypeScript repo as a living graph
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted">
          Resolved imports, renders and calls — not grep. Drill into the 3D graph,
          trace any change’s blast radius, ask it questions.
        </p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-content/5 px-3 focus-within:border-accent/40">
            <Github className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Public GitHub repository URL"
              placeholder="github.com/owner/repo"
              className="flex-1 bg-transparent py-2.5 text-sm text-content outline-none placeholder:text-faint"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || url.trim().length === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent/20 px-4 py-2.5 text-sm font-medium text-violet-100 ring-1 ring-accent/25 transition-[transform,background-color] duration-150 ease-out hover:bg-accent/30 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Indexing…
              </>
            ) : (
              <>
                Explore
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
        {error && (
          <p
            key={error}
            className="animate-shake mt-2 flex items-center gap-1.5 text-xs text-(--status-error)"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <p className="mt-10 text-xs font-medium uppercase tracking-wide text-muted">
          Or open a showcase repo
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {sorted.map((repo) => (
            <RepoCard key={repo.id} repo={repo} onOpen={() => void openRepo(repo.id)} />
          ))}
          {sorted.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading repos…
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const RepoCard = ({
  repo,
  onOpen,
}: {
  repo: RepoSummary;
  onOpen: () => void;
}): React.ReactElement => {
  const ready = repo.status === 'ready';
  const building = repo.status === 'cloning' || repo.status === 'indexing';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!ready}
      aria-busy={building}
      className="glass flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-transform duration-150 ease-out enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 enabled:active:scale-[0.99] disabled:cursor-default disabled:opacity-70"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Github className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-content">
            {repo.label}
          </span>
          <span
            className="block truncate text-xs text-muted"
            title={!ready && !building ? (repo.error ?? 'Failed') : undefined}
          >
            {ready
              ? `${repo.nodeCount} nodes · ${repo.edgeCount} edges`
              : building
                ? repo.status === 'cloning'
                  ? 'Cloning…'
                  : 'Indexing…'
                : (repo.error ?? 'Failed')}
          </span>
        </span>
      </span>
      {ready ? (
        <ArrowRight className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      ) : building ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" aria-hidden="true" />
      ) : (
        <AlertCircle
          className="h-4 w-4 shrink-0 text-(--status-error)"
          aria-hidden="true"
        />
      )}
    </button>
  );
};
