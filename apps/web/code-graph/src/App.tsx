import { useEffect, useState } from 'react';
import { Boxes, RefreshCw, Loader2, Search, FolderOpen } from 'lucide-react';
import { useGraphStore } from './store/graphStore';
import { pathToRoot } from './lib/graph-model';
import { blastRadius, whoRenders, whoCalls, findReferences } from './lib/analysis';
import { QUERY_COLOR, IMPACT_COLOR } from './lib/graph-style';
import { GraphView } from './components/Graph/GraphView';
import { FilterRail } from './components/Rail/FilterRail';
import { Breadcrumbs } from './components/DrillDown/Breadcrumbs';
import { DetailPanel, type QueryItem } from './components/DetailPanel/DetailPanel';
import { ViewControls } from './components/Toolbar/ViewControls';
import { LiveStatus } from './components/Toolbar/LiveStatus';
import { ChatPanel } from './components/Chat/ChatPanel';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { OnboardingHint } from './components/Onboarding/OnboardingHint';

export const App = (): React.ReactElement => {
  const {
    index,
    snapshot,
    focusId,
    selectedId,
    statusVersion,
    knowledgeLoadingId,
    impactSet,
    cycleCount,
    colorMode,
    hiddenTypes,
    hiddenEdges,
    showOnboarding,
    lastUpdatedAt,
    state,
    error,
    load,
    drillInto,
    drillTo,
    select,
    focusOn,
    generateKnowledge,
    runQuery,
    clearQuery,
    highlightKind,
    dismissOnboarding,
    openOnboarding,
    fitSignal,
    recenter,
    goHome,
  } = useGraphStore();

  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // ⌘K / Ctrl-K opens the node search (and the keyboard path into the graph).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (state === 'loading' || state === 'idle') {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="mt-3 text-sm text-muted">Indexing your codebase…</p>
        <p className="mt-1 text-xs text-muted">
          Parsing files, packages and dependencies
        </p>
      </Centered>
    );
  }
  if (state === 'error' || !index || !focusId) {
    return (
      <Centered>
        <span className="text-sm text-(--status-error)">
          {error ?? 'No graph available.'}
        </span>
        <span className="mt-2 text-xs text-muted">
          Start the indexer:{' '}
          <code className="font-mono text-content">
            pnpm --filter indexer-server start
          </code>
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-accent/30"
        >
          Retry
        </button>
      </Centered>
    );
  }

  // A repo with nothing to show (empty / single-node graph) shouldn't read as a
  // stuck spinner — say so plainly, with the same Retry affordance.
  if ((snapshot?.meta.nodeCount ?? 0) <= 1) {
    return (
      <Centered>
        <FolderOpen className="h-6 w-6 text-muted" aria-hidden="true" />
        <p className="mt-3 text-sm text-muted">Nothing to graph yet</p>
        <p className="mt-1 max-w-xs text-center text-xs text-muted">
          The indexer found no source files. Point it at a TypeScript/React repo,
          then re-index.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-accent/30"
        >
          Reload
        </button>
      </Centered>
    );
  }

  const breadcrumbPath = pathToRoot(index, focusId);
  const selectedNode = selectedId ? index.nodeById.get(selectedId) : undefined;
  const queries: QueryItem[] = selectedNode
    ? [
        { kind: 'renders', label: 'Rendered by', count: whoRenders(index.crossEdges, selectedNode.id).length },
        { kind: 'calls', label: 'Called by', count: whoCalls(index.crossEdges, selectedNode.id).length },
        { kind: 'references', label: 'Referenced by', count: findReferences(index.crossEdges, selectedNode.id).length },
        { kind: 'blast-radius', label: 'Blast radius', count: blastRadius(index.crossEdges, selectedNode.id).size },
      ]
    : [];
  const highlightColor = highlightKind
    ? QUERY_COLOR[highlightKind] ?? IMPACT_COLOR
    : IMPACT_COLOR;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line bg-surface px-5 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          {/* Wordmark lockup — gives the tool an identity, not just an icon. */}
          <span className="flex shrink-0 items-center gap-2">
            <Boxes className="h-5 w-5 text-accent" />
            <span className="hidden text-sm font-semibold tracking-tight text-content sm:inline">
              Code Graph
            </span>
          </span>
          <span className="h-4 w-px shrink-0 bg-content/10" aria-hidden="true" />
          <Breadcrumbs path={breadcrumbPath} onNavigate={drillTo} />
        </div>
        <div className="flex items-center gap-3">
          <LiveStatus lastUpdatedAt={lastUpdatedAt} />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Find a node"
            className="flex items-center gap-1.5 rounded-lg border border-line bg-content/5 px-2.5 py-1 text-xs text-muted hover:bg-content/10 hover:text-content"
          >
            <Search className="h-3.5 w-3.5" />
            Find
            <kbd className="ml-0.5 rounded bg-content/10 px-1 py-0.5 text-[10px] text-muted">
              ⌘K
            </kbd>
          </button>
          {cycleCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
              <RefreshCw className="h-3 w-3" />
              {cycleCount} cycles
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <FilterRail />
        <main className="relative min-w-0 flex-1">
          <GraphView
            index={index}
            focusId={focusId}
            selectedId={selectedId}
            statusVersion={statusVersion}
            impactSet={impactSet}
            highlightColor={highlightColor}
            hiddenTypes={hiddenTypes}
            hiddenEdges={hiddenEdges}
            colorMode={colorMode}
            fitSignal={fitSignal}
            onDrill={drillInto}
            onSelect={select}
          />
          <div className="graph-vignette" />
          <ViewControls
            onHome={goHome}
            onRecenter={recenter}
            onHelp={openOnboarding}
          />
          {showOnboarding && (
            <OnboardingHint
              nodeCount={snapshot?.meta.nodeCount ?? 0}
              onDismiss={dismissOnboarding}
            />
          )}
          <ChatPanel
            onCite={focusOn}
            resolveCitation={(id) => {
              const n = index.nodeById.get(id);
              return n ? { name: n.name, type: n.type } : null;
            }}
          />
          {paletteOpen && (
            <CommandPalette
              nodes={snapshot?.nodes ?? []}
              onClose={() => setPaletteOpen(false)}
              onPick={(id) => {
                const hasChildren =
                  (index.childrenOf.get(id)?.length ?? 0) > 0;
                if (hasChildren) drillInto(id);
                else focusOn(id);
              }}
            />
          )}
        </main>
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            childCount={index.childrenOf.get(selectedNode.id)?.length ?? 0}
            knowledgeLoading={knowledgeLoadingId === selectedNode.id}
            queries={queries}
            activeKind={highlightKind}
            onRunQuery={(kind) => runQuery(kind, selectedNode.id)}
            onClearQuery={clearQuery}
            onGenerateKnowledge={() => void generateKnowledge(selectedNode.id)}
            onClose={() => select(null)}
          />
        )}
      </div>
    </div>
  );
};

const Centered = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => (
  <div className="flex h-full flex-col items-center justify-center text-muted">
    {children}
  </div>
);
