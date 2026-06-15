import { useEffect, useState } from 'react';

const relative = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
};

/**
 * "Live · Updated Xs ago" pill. Closes the loop on the product's promise that
 * the graph updates as you code — the dot pulses (stilled under reduced-motion),
 * and the label re-renders on a 5s tick so "ago" stays honest.
 */
export const LiveStatus = ({
  lastUpdatedAt,
}: {
  lastUpdatedAt: number | null;
}): React.ReactElement => {
  // Read the clock in async callbacks only — never during render
  // (react-hooks/purity) nor synchronously in the effect (set-state-in-effect).
  const [now, setNow] = useState(0);
  useEffect(() => {
    const seed = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, []);

  const label =
    lastUpdatedAt && now ? `Updated ${relative(now - lastUpdatedAt)}` : 'Live';

  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-muted sm:flex"
      title="The graph re-indexes live as you edit files"
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {label}
    </span>
  );
};
