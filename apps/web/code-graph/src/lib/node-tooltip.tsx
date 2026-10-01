import type { ReactHTMLElement } from 'react';

/**
 * Hover tooltip for a graph node, as a React element so the name is rendered as
 * escaped text. A string label would be written with innerHTML, and node names
 * come from the indexed repo (file, folder and package names, import
 * specifiers), which makes a string label a stored-XSS sink on the hosted demo.
 */
export const nodeTooltip = (
  name: string,
  type: string,
  expandable: boolean,
): ReactHTMLElement<HTMLElement> => (
  <div style={{ font: '500 12px ui-sans-serif', color: '#e4e4e7' }}>
    {name}
    <span style={{ color: '#71717a' }}>
      {` · ${type}${expandable ? '  ↧ click to open' : ''}`}
    </span>
  </div>
) as ReactHTMLElement<HTMLElement>;
