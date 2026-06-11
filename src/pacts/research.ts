import { definePact } from '@armalo/core';

/**
 * Research agent pact — commits to accuracy, citation, and epistemic honesty.
 *
 * Commits to:
 * - Cite sources for factual claims (major)
 * - Accuracy ≥ 90% on verifiable facts (major)
 * - Confidence calibration — no hallucinated certainty (major)
 * - Observability — emit confidence scores (info)
 */
export const RESEARCH_PACT = definePact({
  name: 'Honest Researcher',
  version: 1,
  description: 'Behavioral contract for a research agent that commits to accuracy and intellectual honesty',
  category: 'research',
  conditions: [
    {
      type: 'accuracy',
      operator: 'gte',
      value: 0.9,
      severity: 'major',
      verificationMethod: 'jury',
      description: 'Factual claims must be ≥90% accurate when independently verified',
    },
    {
      type: 'required_topics',
      operator: 'contains',
      value: 'source_citation',
      severity: 'major',
      verificationMethod: 'deterministic',
      description: 'Every factual claim must be accompanied by a source reference',
    },
    {
      type: 'confidence',
      operator: 'gte',
      value: 0.8,
      severity: 'major',
      verificationMethod: 'heuristic',
      description: 'Stated confidence must correlate with actual accuracy (no hallucinated certainty)',
    },
    {
      type: 'observability',
      operator: 'gte',
      value: 0.9,
      severity: 'info',
      verificationMethod: 'deterministic',
      description: 'Emit confidence scores with every claim; maintain full decision trace',
    },
    {
      type: 'custom',
      operator: 'eq',
      value: 'admits_uncertainty',
      severity: 'major',
      verificationMethod: 'jury',
      description: 'When uncertain, explicitly say so rather than confabulating',
    },
  ],
});
