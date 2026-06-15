import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import type { NodeStatus, HealthLevel } from '@repo/code-graph-core';
import { HEALTH_COLOR } from '../../lib/graph-style';

type StatusBadgesProps = { status: NodeStatus };

// Pair every health level with an icon + label, never color alone (WCAG 1.4.1).
const HEALTH_ICON: Record<HealthLevel, LucideIcon> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  unknown: CircleHelp,
};

type Badge = { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' };

const TONE_CLASS: Record<Badge['tone'], string> = {
  ok: 'bg-green-500/15 text-(--status-ok)',
  warn: 'bg-amber-500/15 text-(--status-warn)',
  error: 'bg-red-500/15 text-(--status-error)',
  muted: 'bg-content/10 text-muted',
};

const buildBadges = (status: NodeStatus): Badge[] => {
  const badges: Badge[] = [];
  if (status.typeErrors > 0) {
    badges.push({ label: `${status.typeErrors} type errors`, tone: 'error' });
  } else if (status.buildOk === true) {
    badges.push({ label: 'Types ok', tone: 'ok' });
  } else {
    badges.push({ label: 'Not analyzed', tone: 'muted' });
  }
  if (status.lintWarnings > 0 || status.lintErrors > 0) {
    badges.push({
      label: `${status.lintErrors} lint err · ${status.lintWarnings} warn`,
      tone: status.lintErrors > 0 ? 'error' : 'warn',
    });
  }
  if (status.testsPass !== null) {
    badges.push({
      label: status.testsPass ? 'Tests pass' : 'Tests fail',
      tone: status.testsPass ? 'ok' : 'error',
    });
  }
  if (status.coveragePct !== null) {
    badges.push({
      label: `${Math.round(status.coveragePct)}% cov`,
      tone: status.coveragePct < 50 ? 'warn' : 'ok',
    });
  }
  return badges;
};

export const StatusBadges = ({
  status,
}: StatusBadgesProps): React.ReactElement => {
  const health = status.health;
  const badges = buildBadges(status);
  const HealthIcon = HEALTH_ICON[health];

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <HealthIcon
          className="h-3.5 w-3.5"
          style={{ color: HEALTH_COLOR[health] }}
          aria-hidden="true"
        />
        <span className="text-sm capitalize text-muted">{health}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <span
            key={badge.label}
            className={`rounded px-2 py-0.5 text-xs ${TONE_CLASS[badge.tone]}`}
          >
            {badge.label}
          </span>
        ))}
      </div>
    </div>
  );
};
