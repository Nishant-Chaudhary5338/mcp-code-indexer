import { MousePointerClick, Search, ZoomIn, X } from 'lucide-react';

type OnboardingHintProps = {
  nodeCount: number;
  onDismiss: () => void;
};

const TIPS = [
  { icon: MousePointerClick, text: 'Click a node to drill into it' },
  { icon: ZoomIn, text: 'Scroll to zoom · drag to rotate' },
  { icon: Search, text: 'Hover a node to trace its dependencies' },
];

export const OnboardingHint = ({
  nodeCount,
  onDismiss,
}: OnboardingHintProps): React.ReactElement => (
  <div className="animate-rise glass absolute left-5 top-5 w-72 rounded-2xl p-4">
    <div className="mb-2 flex items-start justify-between">
      <h2 className="text-sm font-semibold text-content">
        Your codebase, as a living map
      </h2>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss tips"
        className="rounded p-0.5 text-faint transition-colors hover:text-content"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
    <p className="mb-3 text-xs leading-relaxed text-muted">
      {nodeCount.toLocaleString()} files, packages and components — indexed live
      and updating as you code.
    </p>
    <ul className="space-y-2">
      {TIPS.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-center gap-2.5 text-xs text-muted">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
            <Icon className="h-3.5 w-3.5" />
          </span>
          {text}
        </li>
      ))}
    </ul>
    <button
      type="button"
      onClick={onDismiss}
      className="mt-3 w-full rounded-lg bg-violet-500/20 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/30"
    >
      Got it
    </button>
  </div>
);
