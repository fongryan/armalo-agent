import type { TrustScoreSnapshot } from '../types.js';

const TIER_COLORS = {
  platinum: '\x1b[96m',  // bright cyan
  gold: '\x1b[93m',      // bright yellow
  silver: '\x1b[37m',    // white
  bronze: '\x1b[33m',    // yellow
  null: '\x1b[90m',      // gray
} as const;

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/**
 * Print a formatted trust score report to the terminal.
 */
export function printTrustScore(score: TrustScoreSnapshot): void {
  const tierColor = TIER_COLORS[score.tier ?? 'null'];
  const tierLabel = score.tier ? score.tier.charAt(0).toUpperCase() + score.tier.slice(1) : 'Unranked';
  const pct = Math.round(score.compositeScore * 10) / 10;

  console.log('');
  console.log(`${BOLD}╭── Armalo Trust Score ──────────────────────────────╮${RESET}`);
  console.log(`${BOLD}│${RESET}  Agent:     ${DIM}${score.agentId}${RESET}`);
  console.log(`${BOLD}│${RESET}  Score:     ${BOLD}${pct}/1000${RESET}   ${tierColor}${BOLD}[${tierLabel}]${RESET}`);
  console.log(`${BOLD}│${RESET}  Confidence: ${Math.round(score.confidence * 100)}%`);
  console.log(`${BOLD}│${RESET}`);
  console.log(`${BOLD}│${RESET}  Dimensions:`);

  const dims = Object.entries(score.dimensions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  for (const [dim, val] of dims) {
    const bar = renderBar(val, 12);
    const pctStr = `${Math.round(val * 100)}%`.padStart(4);
    console.log(`${BOLD}│${RESET}    ${dim.padEnd(22)} ${bar} ${pctStr}`);
  }

  console.log(`${BOLD}│${RESET}`);
  console.log(`${BOLD}│${RESET}  ${DIM}Evaluated: ${new Date(score.evaluatedAt).toLocaleString()}${RESET}`);
  console.log(`${BOLD}│${RESET}  ${DIM}View full report: https://armalo.ai/dashboard/agents/${score.agentId}${RESET}`);
  console.log(`${BOLD}╰────────────────────────────────────────────────────╯${RESET}`);
  console.log('');
}

function renderBar(value: number, width: number): string {
  const filled = Math.round(value * width);
  const empty = width - filled;
  const color = value >= 0.8 ? '\x1b[32m' : value >= 0.5 ? '\x1b[33m' : '\x1b[31m';
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}

export function formatScore(score: TrustScoreSnapshot): string {
  const tierLabel = score.tier ? ` [${score.tier}]` : '';
  return `Trust score: ${Math.round(score.compositeScore * 10) / 10}/1000${tierLabel}`;
}
