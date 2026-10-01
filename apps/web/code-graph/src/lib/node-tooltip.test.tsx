import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { nodeTooltip } from './node-tooltip';

describe('nodeTooltip', () => {
  it('renders a hostile node name as escaped text, never as markup', () => {
    const html = renderToStaticMarkup(nodeTooltip('<img src=x onerror=alert(1)>', 'file', false));

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shows the node type and the drill-in hint for expandable nodes', () => {
    expect(renderToStaticMarkup(nodeTooltip('src', 'folder', true))).toContain(
      ' · folder  ↧ click to open',
    );
    expect(renderToStaticMarkup(nodeTooltip('App', 'component', false))).not.toContain('click');
  });
});
