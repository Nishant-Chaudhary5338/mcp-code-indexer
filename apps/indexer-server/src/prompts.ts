import { nodePath, type GraphNode } from '@repo/code-graph-core';

export const summaryPrompt = (node: GraphNode, source: string): string => {
  const filePath = nodePath(node);
  return [
    `You are documenting a TypeScript/React codebase.`,
    `In 1-2 plain sentences, describe what this ${node.type} does and why it exists.`,
    `Be specific and concrete. No preamble, no markdown, just the description.`,
    ``,
    `Name: ${node.name}`,
    filePath ? `Path: ${filePath}` : '',
    ``,
    `Code:`,
    '```tsx',
    source,
    '```',
  ]
    .filter(Boolean)
    .join('\n');
};

export const chatPrompt = (
  question: string,
  context: { path: string; source: string }[],
): string =>
  [
    `You are a senior engineer answering a question about a codebase.`,
    `Use ONLY the provided code. Cite the relevant file path(s) inline.`,
    `Be concise and concrete. If the code does not contain the answer, say so.`,
    ``,
    `Question: ${question}`,
    ``,
    `Relevant code:`,
    ...context.map((c) => `\n// ${c.path}\n${c.source}`),
  ].join('\n');
