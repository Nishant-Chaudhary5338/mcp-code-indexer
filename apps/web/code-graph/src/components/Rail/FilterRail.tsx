import { motion } from 'framer-motion';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Boxes,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { NodeType } from '@repo/code-graph-core';
import { useGraphStore } from '../../store/graphStore';
import { nodeTypeColor, edgeTypeColor } from '../../lib/graph-style';

// The controls that used to crowd the top bar — node/edge filters, color mode,
// and the 2D/3D toggle — live here in a collapsible left rail.

const NODE_TYPES: NodeType[] = [
  'app',
  'package',
  'folder',
  'file',
  'component',
  'function',
  'external',
];
const TYPE_LABEL: Record<NodeType, string> = {
  repo: 'Repo',
  app: 'App',
  package: 'Package',
  folder: 'Folder',
  file: 'File',
  component: 'Component',
  function: 'Function',
  external: 'External',
};

const EDGE_TYPES = [
  'imports',
  'renders',
  'calls',
  'references',
  'depends-on',
  'contains',
] as const;
const EDGE_LABEL: Record<string, string> = {
  imports: 'Imports',
  renders: 'Renders',
  calls: 'Calls',
  references: 'References',
  'depends-on': 'Depends-on',
  contains: 'Contains',
};

const spring = { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 } as const;

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement => (
  <section className="mb-4">
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
      {title}
    </h3>
    {children}
  </section>
);

const Segmented = <T extends string>({
  options,
  value,
  onChange,
  groupId,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
  // Scopes the sliding pill's layoutId so multiple toggles don't share one.
  groupId: string;
}): React.ReactElement => (
  <div className="flex rounded-lg border border-line bg-content/5 p-0.5">
    {options.map(([v, label]) => {
      const active = v === value;
      return (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className="relative flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
        >
          {active && (
            <motion.span
              layoutId={`rail-seg-${groupId}`}
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              className="absolute inset-0 rounded-md bg-accent/20 ring-1 ring-accent/40"
            />
          )}
          <span
            className={`relative ${active ? 'text-accent' : 'text-muted hover:text-content'}`}
          >
            {label}
          </span>
        </button>
      );
    })}
  </div>
);

const FilterRow = ({
  color,
  label,
  hidden,
  swatch,
  onClick,
}: {
  color: string;
  label: string;
  hidden: boolean;
  swatch: 'dot' | 'line';
  onClick: () => void;
}): React.ReactElement => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={!hidden}
    className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-content/5"
  >
    {swatch === 'dot' ? (
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color, opacity: hidden ? 0.3 : 1 }}
      />
    ) : (
      <span
        className="h-[3px] w-3.5 shrink-0 rounded-full"
        style={{ backgroundColor: color, opacity: hidden ? 0.3 : 1 }}
      />
    )}
    <span className={`flex-1 text-left ${hidden ? 'text-faint line-through' : ''}`}>
      {label}
    </span>
    {hidden ? (
      <EyeOff className="h-3.5 w-3.5 text-faint" />
    ) : (
      <Eye className="h-3.5 w-3.5 text-faint opacity-0 group-hover:opacity-100" />
    )}
  </button>
);

export const FilterRail = (): React.ReactElement => {
  const hiddenTypes = useGraphStore((s) => s.hiddenTypes);
  const hiddenEdges = useGraphStore((s) => s.hiddenEdges);
  const toggleType = useGraphStore((s) => s.toggleType);
  const toggleEdge = useGraphStore((s) => s.toggleEdge);
  const colorMode = useGraphStore((s) => s.colorMode);
  const setColorMode = useGraphStore((s) => s.setColorMode);
  const renderMode = useGraphStore((s) => s.renderMode);
  const setRenderMode = useGraphStore((s) => s.setRenderMode);
  const layout = useGraphStore((s) => s.layout);
  const setLayout = useGraphStore((s) => s.setLayout);
  const theme = useGraphStore((s) => s.theme);
  const setTheme = useGraphStore((s) => s.setTheme);
  const collapsed = useGraphStore((s) => s.railCollapsed);
  const toggleRail = useGraphStore((s) => s.toggleRail);

  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={toggleRail}
          aria-label="Expand filters"
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-content/10 hover:text-content"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <span className="my-1 h-px w-5 bg-content/10" />
        {NODE_TYPES.map((t) => (
          <span
            key={t}
            title={TYPE_LABEL[t]}
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: nodeTypeColor(t, theme), opacity: hiddenTypes.has(t) ? 0.25 : 1 }}
          />
        ))}
      </div>
    );
  }

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 248, opacity: 1 }}
      transition={spring}
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-surface backdrop-blur-xl"
    >
      <div className="flex items-center justify-between px-4 py-3.5">
        <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          <Boxes className="h-4 w-4 text-accent" />
          Filters
        </span>
        <button
          type="button"
          onClick={toggleRail}
          aria-label="Collapse filters"
          className="rounded-md p-1 text-faint transition-colors hover:bg-content/10 hover:text-content"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <Section title="View">
          <Segmented
            groupId="view"
            options={[
              ['3d', '3D'],
              ['2d', '2D'],
            ]}
            value={renderMode}
            onChange={setRenderMode}
          />
        </Section>

        <Section title="Layout">
          <Segmented
            groupId="layout"
            options={[
              ['structure', 'Structure'],
              ['dependency', 'Dependencies'],
            ]}
            value={layout}
            onChange={setLayout}
          />
        </Section>

        <Section title="Color by">
          <Segmented
            groupId="color"
            options={[
              ['type', 'Type'],
              ['health', 'Health'],
            ]}
            value={colorMode}
            onChange={setColorMode}
          />
        </Section>

        <Section title="Theme">
          <Segmented
            groupId="theme"
            options={[
              ['dark', 'Dark'],
              ['light', 'Light'],
            ]}
            value={theme}
            onChange={setTheme}
          />
        </Section>

        <Section title="Node types">
          <div className="flex flex-col gap-0.5">
            {NODE_TYPES.map((t) => (
              <FilterRow
                key={t}
                color={nodeTypeColor(t, theme)}
                label={TYPE_LABEL[t]}
                hidden={hiddenTypes.has(t)}
                swatch="dot"
                onClick={() => toggleType(t)}
              />
            ))}
          </div>
        </Section>

        <Section title="Edges">
          <div className="flex flex-col gap-0.5">
            {EDGE_TYPES.map((e) => (
              <FilterRow
                key={e}
                color={edgeTypeColor(e, theme)}
                label={EDGE_LABEL[e] ?? e}
                hidden={hiddenEdges.has(e)}
                swatch="line"
                onClick={() => toggleEdge(e)}
              />
            ))}
          </div>
        </Section>
      </div>
    </motion.aside>
  );
};
