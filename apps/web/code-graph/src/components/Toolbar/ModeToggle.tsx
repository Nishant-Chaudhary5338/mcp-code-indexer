import type { ColorMode } from '../../store/graphStore';

type ModeToggleProps = {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
};

const OPTIONS: { value: ColorMode; label: string }[] = [
  { value: 'type', label: 'Type' },
  { value: 'health', label: 'Health' },
];

export const ModeToggle = ({
  mode,
  onChange,
}: ModeToggleProps): React.ReactElement => (
  <div className="flex rounded-lg border border-line bg-content/5 p-0.5 backdrop-blur-xl">
    {OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
          mode === option.value
            ? 'bg-content/10 text-content'
            : 'text-faint hover:text-muted'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);
