import type { NodeType, HealthLevel, GraphEdge } from '@repo/code-graph-core';
import type { ColorMode } from '../../store/graphStore';
import { TYPE_COLOR, HEALTH_COLOR, EDGE_COLOR } from '../../lib/graph-style';
import { TYPE_LABEL, EDGE_LABEL } from '../../lib/graph-model';

type LegendProps = { mode: ColorMode };

const TYPE_ORDER: NodeType[] = [
  'app',
  'package',
  'folder',
  'file',
  'component',
  'function',
];
const HEALTH_ITEMS: { level: HealthLevel; label: string }[] = [
  { level: 'ok', label: 'Healthy' },
  { level: 'warn', label: 'Warnings' },
  { level: 'error', label: 'Type errors' },
  { level: 'unknown', label: 'Not analyzed' },
];
// Relationship edges worth explaining (the structural `contains` edge is implied
// by the drill-down tree, so it is omitted here).
const EDGE_ORDER: GraphEdge['type'][] = [
  'imports',
  'renders',
  'calls',
  'references',
  'depends-on',
];

const Swatch = ({
  color,
  label,
}: {
  color: string;
  label: string;
}): React.ReactElement => (
  <span className="flex items-center gap-1.5">
    <span
      className="h-2 w-2 rounded-full"
      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
    />
    {label}
  </span>
);

// A short line glyph (rather than a dot) to read as a relationship/edge.
const EdgeSwatch = ({
  color,
  label,
}: {
  color: string;
  label: string;
}): React.ReactElement => (
  <span className="flex items-center gap-1.5">
    <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
    {label}
  </span>
);

export const Legend = ({ mode }: LegendProps): React.ReactElement => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
    {mode === 'type'
      ? TYPE_ORDER.map((type) => (
          <Swatch key={type} color={TYPE_COLOR[type]} label={TYPE_LABEL[type]} />
        ))
      : HEALTH_ITEMS.map((item) => (
          <Swatch
            key={item.level}
            color={HEALTH_COLOR[item.level]}
            label={item.label}
          />
        ))}
    <span className="mx-0.5 h-3 w-px bg-line" aria-hidden />
    {EDGE_ORDER.map((type) => (
      <EdgeSwatch
        key={type}
        color={EDGE_COLOR[type] ?? '#52525b'}
        label={EDGE_LABEL[type]}
      />
    ))}
  </div>
);
