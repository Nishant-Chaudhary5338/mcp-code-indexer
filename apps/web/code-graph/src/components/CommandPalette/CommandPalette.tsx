import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Crosshair,
  Home,
  PanelLeft,
  Palette,
  HeartPulse,
  HelpCircle,
  Radius,
  GitBranch,
  PhoneOutgoing,
  CaseSensitive,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { GraphNode } from '@repo/code-graph-core';
import { nodePath } from '@repo/code-graph-core';
import { nodeTypeColor } from '../../lib/graph-style';
import { TYPE_LABEL } from '../../lib/graph-model';
import { useGraphStore } from '../../store/graphStore';
import { fetchSemanticSearch } from '../../api/client';

/** Search mode: lexical name/path match vs. embedding similarity ("by meaning"). */
type SearchMode = 'name' | 'meaning';
const SEMANTIC_DEBOUNCE_MS = 300;

type CommandPaletteProps = {
  nodes: GraphNode[];
  onClose: () => void;
  onPick: (id: string) => void;
};

/** A runnable command surfaced in the palette. */
type Command = {
  id: string;
  title: string;
  icon: LucideIcon;
  run: () => void;
};

/** A flat, navigable row — either a command or a node — so arrow/Enter span both. */
type Row =
  | { kind: 'command'; command: Command }
  | { kind: 'node'; node: GraphNode };

const SEARCHABLE = new Set([
  'file',
  'component',
  'function',
  'folder',
  'package',
  'app',
]);
const MAX_RESULTS = 30;

/** Name-first fuzzy score (exact > prefix > substring), then path substring. */
const scoreText = (haystackName: string, haystackPath: string, q: string): number => {
  if (!q) return 0;
  if (haystackName === q) return 100;
  if (haystackName.startsWith(q)) return 60;
  if (haystackName.includes(q)) return 40;
  if (haystackPath.includes(q)) return 20;
  return -1;
};

/**
 * ⌘K / Ctrl-K command surface. Two layers over one keyboard model:
 *
 *  - **Commands** — view/query actions run straight against the store (recenter,
 *    color mode, reverse-queries on the selection, …). The selection-scoped
 *    commands only appear when a node is selected.
 *  - **Nodes** — the original fuzzy node search (exact > prefix > substring on
 *    name, then path), the keyboard-accessible path into the pointer-driven 3D
 *    canvas: type, arrow, Enter to jump.
 *
 * Both groups flatten into one `rows` list, so a single `active` index and the
 * arrow/Enter/Esc handler walk commands and nodes as one continuous list. Node
 * picks still go through `onPick`; command picks run their store action. Props
 * are unchanged — App needs no edits.
 */
// Mounted only while open (App gates it), so state resets on each open without a
// reset effect — keeps the strict react-hooks rules happy.
export const CommandPalette = ({
  nodes,
  onClose,
  onPick,
}: CommandPaletteProps): React.ReactElement => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<SearchMode>('name');
  const [semanticIds, setSemanticIds] = useState<string[]>([]);
  const [semanticHint, setSemanticHint] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const recenter = useGraphStore((s) => s.recenter);
  const goHome = useGraphStore((s) => s.goHome);
  const toggleRail = useGraphStore((s) => s.toggleRail);
  const setColorMode = useGraphStore((s) => s.setColorMode);
  const openOnboarding = useGraphStore((s) => s.openOnboarding);
  const runQuery = useGraphStore((s) => s.runQuery);
  const selectedId = useGraphStore((s) => s.selectedId);
  const theme = useGraphStore((s) => s.theme);

  useEffect(() => {
    // Focus the input on mount (a ref side effect, not state).
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const nodesById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n] as const)),
    [nodes],
  );

  // In "meaning" mode, fetch embedding-ranked ids from the server (debounced).
  // Cancels stale requests via an ignore flag so out-of-order responses can't
  // clobber a newer query. All state is set inside callbacks (never synchronously
  // in the effect body); stale results are filtered out at render via `mode`/`query`.
  useEffect(() => {
    const q = query.trim();
    if (mode !== 'meaning' || q.length === 0) return;
    let ignore = false;
    const timer = setTimeout(() => {
      setSearching(true);
      fetchSemanticSearch(q)
        .then((res) => {
          if (ignore) return;
          setSemanticIds(res.results.map((r) => r.id));
          setSemanticHint(res.usedEmbeddings ? null : (res.hint ?? null));
        })
        .catch(() => {
          if (!ignore) setSemanticHint('Semantic search failed — is the server running?');
        })
        .finally(() => {
          if (!ignore) setSearching(false);
        });
    }, SEMANTIC_DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [query, mode]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: 'recenter', title: 'Recenter view', icon: Crosshair, run: recenter },
      { id: 'home', title: 'Go to repo root', icon: Home, run: goHome },
      { id: 'toggle-rail', title: 'Toggle filters rail', icon: PanelLeft, run: toggleRail },
      {
        id: 'color-type',
        title: 'Color by type',
        icon: Palette,
        run: () => setColorMode('type'),
      },
      {
        id: 'color-health',
        title: 'Color by health',
        icon: HeartPulse,
        run: () => setColorMode('health'),
      },
      {
        id: 'onboarding',
        title: 'Show onboarding / help',
        icon: HelpCircle,
        run: openOnboarding,
      },
    ];
    if (selectedId) {
      const sel = selectedId;
      base.push(
        {
          id: 'blast-radius',
          title: 'Blast radius of selection',
          icon: Radius,
          run: () => runQuery('blast-radius', sel),
        },
        {
          id: 'renders',
          title: 'Who renders selection',
          icon: GitBranch,
          run: () => runQuery('renders', sel),
        },
        {
          id: 'calls',
          title: 'Who calls selection',
          icon: PhoneOutgoing,
          run: () => runQuery('calls', sel),
        },
      );
    }
    return base;
  }, [recenter, goHome, toggleRail, setColorMode, openOnboarding, runQuery, selectedId]);

  const matchedCommands = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const title = c.title.toLowerCase();
      return title.includes(q);
    });
  }, [commands, query]);

  const localNodes = useMemo<GraphNode[]>(() => {
    const q = query.trim().toLowerCase();
    const scored: { node: GraphNode; score: number }[] = [];
    for (const node of nodes) {
      if (!SEARCHABLE.has(node.type)) continue;
      const name = node.name.toLowerCase();
      const path = (nodePath(node) ?? '').toLowerCase();
      const score = scoreText(name, path, q);
      // With an empty query the original behavior showed nothing in the node
      // group (score 0) — now the Commands group carries the empty state, so we
      // keep nodes hidden until the user types.
      if (!q || score < 0) continue;
      scored.push({ node, score });
    }
    scored.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name));
    return scored.slice(0, MAX_RESULTS).map((s) => s.node);
  }, [nodes, query]);

  // Meaning mode: resolve the server's ranked ids to live nodes, preserving rank.
  const semanticNodes = useMemo<GraphNode[]>(
    () => semanticIds.map((id) => nodesById.get(id)).filter((n): n is GraphNode => !!n),
    [semanticIds, nodesById],
  );

  // Only show semantic results for a live meaning-mode query; otherwise stale ids
  // from a prior search could leak through (we don't clear them in the effect).
  const meaningActive = mode === 'meaning' && query.trim().length > 0;
  const matchedNodes = useMemo<GraphNode[]>(
    () => (mode === 'meaning' ? (meaningActive ? semanticNodes : []) : localNodes),
    [mode, meaningActive, semanticNodes, localNodes],
  );

  // Flatten both groups into one navigable list; `active` indexes into this.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const command of matchedCommands) out.push({ kind: 'command', command });
    for (const node of matchedNodes) out.push({ kind: 'node', node });
    return out;
  }, [matchedCommands, matchedNodes]);

  const commandCount = matchedCommands.length;

  const pick = (i: number): void => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === 'command') {
      row.command.run();
      onClose();
    } else {
      onPick(row.node.id);
      onClose();
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="glass w-[34rem] max-w-[90vw] overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(active);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            aria-label={
              mode === 'meaning'
                ? 'Search the codebase by meaning'
                : 'Run a command or search nodes by name or path'
            }
            placeholder={
              mode === 'meaning'
                ? 'Describe what you’re looking for…'
                : 'Run a command or find a file, component or function…'
            }
            className="flex-1 bg-transparent text-sm text-content outline-none placeholder:text-faint"
          />
          {/* Name ⇄ Meaning search toggle. Meaning routes to embedding search. */}
          <div
            className="flex shrink-0 overflow-hidden rounded-md border border-line"
            role="group"
            aria-label="Search mode"
          >
            {(
              [
                { value: 'name', label: 'Name', icon: CaseSensitive },
                { value: 'meaning', label: 'Meaning', icon: Sparkles },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={mode === opt.value}
                title={opt.value === 'meaning' ? 'Find by meaning (embeddings)' : 'Match by name / path'}
                onClick={() => {
                  setMode(opt.value);
                  setActive(0);
                  inputRef.current?.focus();
                }}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                  mode === opt.value
                    ? 'bg-accent/15 text-accent'
                    : 'text-faint hover:text-muted'
                }`}
              >
                <opt.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {meaningActive && (searching || semanticHint) && (
          <div className="border-b border-line px-4 py-1.5 text-[11px] text-muted">
            {searching ? 'Searching by meaning…' : semanticHint}
          </div>
        )}
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox" aria-label="Results">
          {rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted">
              {query ? 'No matching commands or nodes' : 'Type to search the graph'}
            </li>
          ) : (
            rows.map((row, i) =>
              row.kind === 'command' ? (
                <li key={`cmd-${row.command.id}`}>
                  {i === 0 && (
                    <div className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-faint">
                      Commands
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(i)}
                    className={`flex w-full items-center gap-2.5 px-4 py-2 text-left ${
                      i === active ? 'bg-content/10' : ''
                    }`}
                  >
                    <row.command.icon
                      className="h-4 w-4 shrink-0 text-muted"
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm text-content">
                      {row.command.title}
                    </span>
                    <kbd className="ml-auto shrink-0 rounded bg-content/10 px-1.5 py-0.5 text-[10px] text-muted">
                      Command
                    </kbd>
                  </button>
                </li>
              ) : (
                <li key={row.node.id}>
                  {i === commandCount && (
                    <div className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-faint">
                      Nodes
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(i)}
                    className={`flex w-full items-center gap-2.5 px-4 py-2 text-left ${
                      i === active ? 'bg-content/10' : ''
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeTypeColor(row.node.type, theme) }}
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono text-sm text-content">
                      {row.node.name}
                    </span>
                    <span className="ml-auto shrink-0 truncate pl-3 text-[11px] text-muted">
                      {nodePath(row.node) ?? TYPE_LABEL[row.node.type]}
                    </span>
                  </button>
                </li>
              ),
            )
          )}
        </ul>
      </div>
    </div>
  );
};
