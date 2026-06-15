import { spawn, type ChildProcess } from 'child_process';

export type ClaudeOptions = { model?: string; timeoutMs?: number };

/** Max stderr we retain (bytes-ish) — enough to diagnose, never unbounded. */
const STDERR_CAP = 64 * 1024;
/** Grace period between SIGTERM and the SIGKILL escalation on timeout. */
const KILL_GRACE_MS = 2000;

/**
 * Live children, so a graceful shutdown can reap any in-flight Claude CLIs.
 * Each is detached and leads its own process group; we kill the whole group.
 */
const liveChildren = new Set<ChildProcess>();

/** Best-effort kill of a detached child's entire process group. */
const killGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid == null) return;
  try {
    // Negative pid targets the process group (requires detached spawn) so any
    // grandchildren the CLI spawned are reaped too.
    process.kill(-child.pid, signal);
  } catch {
    // Group may already be gone; fall back to killing just the child.
    try {
      child.kill(signal);
    } catch {
      /* already dead */
    }
  }
};

/** Terminate all tracked Claude children — called from graceful shutdown. */
export const killAllClaudeChildren = (): void => {
  for (const child of liveChildren) killGroup(child, 'SIGKILL');
  liveChildren.clear();
};

// Drives the locally-installed, locally-authenticated Claude Code CLI in print
// mode — no API key required. Prompt is piped via stdin to avoid arg limits.
export const askClaude = (
  prompt: string,
  options: ClaudeOptions = {},
): Promise<string | null> =>
  new Promise((resolve) => {
    const child = spawn(
      'claude',
      ['-p', '--model', options.model ?? 'haiku', '--no-session-persistence'],
      // detached: lead a new process group so a timeout can kill the whole tree.
      { stdio: ['pipe', 'pipe', 'pipe'], detached: true },
    );
    liveChildren.add(child);

    let out = '';
    let errLen = 0;
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      liveChildren.delete(child);
      resolve(value);
    };

    // Escalation on timeout: SIGTERM, then SIGKILL after a grace period so a
    // wedged CLI can't linger. Kill the group, not just the parent.
    const timer = setTimeout(() => {
      killGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS);
      finish(null);
    }, options.timeoutMs ?? 60000);

    // setEncoding so multibyte UTF-8 isn't split/corrupted across chunks.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    // Drain stderr (capped) so a full stderr pipe can never deadlock the child.
    child.stderr.on('data', (chunk: string) => {
      if (errLen < STDERR_CAP) errLen += chunk.length;
    });

    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out.trim() : null));

    child.stdin.on('error', () => {
      /* child may have exited before we finished writing; ignore EPIPE */
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
