import type { NodeType } from '@repo/code-graph-core';
import { useGraphStore } from '../../store/graphStore';
import type { ColorMode } from '../../store/graphStore';
import type { GraphIndex } from '../../lib/graph-model';
import { CANVAS_BG } from '../../lib/graph-style';
import { GraphCanvas } from './GraphCanvas';
import { GraphCanvas2D } from './GraphCanvas2D';

type GraphViewProps = {
  index: GraphIndex;
  focusId: string;
  selectedId: string | null;
  statusVersion: number;
  impactSet: Set<string> | null;
  highlightColor: string;
  hiddenTypes: Set<NodeType>;
  hiddenEdges: Set<string>;
  colorMode: ColorMode;
  fitSignal: number;
  onDrill: (id: string) => void;
  onSelect: (id: string) => void;
};

// Renders the 3D or 2D graph based on the store's renderMode. Keying by mode
// remounts the chosen renderer cleanly on switch (fresh canvas + force sim).
export const GraphView = (props: GraphViewProps): React.ReactElement => {
  const renderMode = useGraphStore((s) => s.renderMode);
  const theme = useGraphStore((s) => s.theme);
  const layout = useGraphStore((s) => s.layout);
  const Renderer = renderMode === '3d' ? GraphCanvas : GraphCanvas2D;
  // Key by mode, theme AND layout: remounting rebuilds the scene/background and
  // resets the force simulation so a layout switch re-clusters cleanly.
  return (
    <Renderer
      key={`${renderMode}-${theme}-${layout}`}
      background={CANVAS_BG[theme]}
      theme={theme}
      layout={layout}
      {...props}
    />
  );
};
