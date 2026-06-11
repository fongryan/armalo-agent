import { describe, it, expect } from 'vitest';
import { SAFETY_DEFAULTS } from './safety.js';
import { RESEARCH_PACT } from './research.js';
import { CODING_PACT } from './coding.js';
import { CUSTOMER_SUPPORT_PACT } from './customer-support.js';
import type { PactDefinition } from '@armalo/core';

const ALL_PACTS: Array<[string, PactDefinition]> = [
  ['SAFETY_DEFAULTS', SAFETY_DEFAULTS],
  ['RESEARCH_PACT', RESEARCH_PACT],
  ['CODING_PACT', CODING_PACT],
  ['CUSTOMER_SUPPORT_PACT', CUSTOMER_SUPPORT_PACT],
];

// ── Shared invariants across all pacts ────────────────────────────────────────

describe('all pacts — shared invariants', () => {
  it.each(ALL_PACTS)('%s has a non-empty name', (_name, pact) => {
    expect(pact.name.length).toBeGreaterThan(0);
  });

  it.each(ALL_PACTS)('%s has a non-empty description', (_name, pact) => {
    expect(pact.description.length).toBeGreaterThan(0);
  });

  it.each(ALL_PACTS)('%s has at least 2 conditions', (_name, pact) => {
    expect(pact.conditions.length).toBeGreaterThanOrEqual(2);
  });

  it.each(ALL_PACTS)('%s — every condition has a non-empty type', (_name, pact) => {
    for (const c of pact.conditions) {
      expect(typeof c.type).toBe('string');
      expect(c.type.length).toBeGreaterThan(0);
    }
  });

  it.each(ALL_PACTS)('%s — every condition has an operator', (_name, pact) => {
    for (const c of pact.conditions) {
      expect(c.operator).toBeDefined();
    }
  });

  it.each(ALL_PACTS)('%s — every condition has a non-empty description', (_name, pact) => {
    for (const c of pact.conditions) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it.each(ALL_PACTS)('%s — every condition has a valid severity', (_name, pact) => {
    const validSeverities = new Set(['critical', 'major', 'minor', 'info']);
    for (const c of pact.conditions) {
      expect(validSeverities.has(c.severity)).toBe(true);
    }
  });

  it.each(ALL_PACTS)('%s — every condition has a verificationMethod', (_name, pact) => {
    const validMethods = new Set(['heuristic', 'jury', 'deterministic', 'custom']);
    for (const c of pact.conditions) {
      expect(validMethods.has(c.verificationMethod)).toBe(true);
    }
  });

  it.each(ALL_PACTS)('%s — every condition value is defined', (_name, pact) => {
    for (const c of pact.conditions) {
      expect(c.value).toBeDefined();
    }
  });
});

// ── SAFETY_DEFAULTS ───────────────────────────────────────────────────────────

describe('SAFETY_DEFAULTS', () => {
  it('has category "safety"', () => {
    expect(SAFETY_DEFAULTS.category).toBe('safety');
  });

  it('has a safety condition rated critical', () => {
    const c = SAFETY_DEFAULTS.conditions.find((x) => x.type === 'safety');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('critical');
    expect(c?.operator).toBe('gte');
    expect(c?.value as number).toBeGreaterThanOrEqual(0.9);
  });

  it('has a pii_handling condition rated critical', () => {
    const c = SAFETY_DEFAULTS.conditions.find((x) => x.type === 'pii_handling');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('critical');
  });

  it('has a toxicity condition using lt operator', () => {
    const c = SAFETY_DEFAULTS.conditions.find((x) => x.type === 'toxicity');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('lt');
    expect(c?.value as number).toBeLessThan(0.1);
  });

  it('has a prohibited_topics condition using excludes operator', () => {
    const c = SAFETY_DEFAULTS.conditions.find((x) => x.type === 'prohibited_topics');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('excludes');
    expect(Array.isArray(c?.value)).toBe(true);
    expect((c?.value as string[]).length).toBeGreaterThan(0);
  });

  it('has at least one critical condition', () => {
    const criticals = SAFETY_DEFAULTS.conditions.filter((c) => c.severity === 'critical');
    expect(criticals.length).toBeGreaterThan(0);
  });
});

// ── RESEARCH_PACT ─────────────────────────────────────────────────────────────

describe('RESEARCH_PACT', () => {
  it('has category "research"', () => {
    expect(RESEARCH_PACT.category).toBe('research');
  });

  it('requires accuracy ≥ 0.9 via jury verification', () => {
    const c = RESEARCH_PACT.conditions.find((x) => x.type === 'accuracy');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('gte');
    expect(c?.value as number).toBeGreaterThanOrEqual(0.9);
    expect(c?.verificationMethod).toBe('jury');
  });

  it('requires source citation via required_topics', () => {
    const c = RESEARCH_PACT.conditions.find((x) => x.type === 'required_topics');
    expect(c).toBeDefined();
    expect(c?.value).toBe('source_citation');
  });

  it('requires confidence calibration', () => {
    const c = RESEARCH_PACT.conditions.find((x) => x.type === 'confidence');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('gte');
    expect(c?.value as number).toBeGreaterThan(0);
  });

  it('requires observability', () => {
    const c = RESEARCH_PACT.conditions.find((x) => x.type === 'observability');
    expect(c).toBeDefined();
  });

  it('requires admits_uncertainty via custom condition', () => {
    const c = RESEARCH_PACT.conditions.find((x) => x.type === 'custom' && x.value === 'admits_uncertainty');
    expect(c).toBeDefined();
  });
});

// ── CODING_PACT ───────────────────────────────────────────────────────────────

describe('CODING_PACT', () => {
  it('has category "engineering"', () => {
    expect(CODING_PACT.category).toBe('engineering');
  });

  it('has safety at critical severity with ≥ 0.99 threshold', () => {
    const c = CODING_PACT.conditions.find((x) => x.type === 'safety');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('critical');
    expect(c?.value as number).toBeGreaterThanOrEqual(0.99);
  });

  it('requires accuracy ≥ 0.95', () => {
    const c = CODING_PACT.conditions.find((x) => x.type === 'accuracy');
    expect(c).toBeDefined();
    expect(c?.value as number).toBeGreaterThanOrEqual(0.95);
  });

  it('has latency condition with lte operator', () => {
    const c = CODING_PACT.conditions.find((x) => x.type === 'latency');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('lte');
  });

  it('has schema_compliance condition for TypeScript strict', () => {
    const c = CODING_PACT.conditions.find((x) => x.type === 'schema_compliance');
    expect(c).toBeDefined();
    expect(c?.value).toBe('typescript_strict');
  });

  it('has reliability condition', () => {
    const c = CODING_PACT.conditions.find((x) => x.type === 'reliability');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('gte');
  });
});

// ── CUSTOMER_SUPPORT_PACT ─────────────────────────────────────────────────────

describe('CUSTOMER_SUPPORT_PACT', () => {
  it('has category "support"', () => {
    expect(CUSTOMER_SUPPORT_PACT.category).toBe('support');
  });

  it('has in_scope_only custom condition', () => {
    const c = CUSTOMER_SUPPORT_PACT.conditions.find((x) => x.type === 'custom' && x.value === 'in_scope_only');
    expect(c).toBeDefined();
  });

  it('requires accuracy ≥ 0.95 at critical severity', () => {
    const c = CUSTOMER_SUPPORT_PACT.conditions.find((x) => x.type === 'accuracy');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('critical');
    expect(c?.value as number).toBeGreaterThanOrEqual(0.95);
  });

  it('has latency ≤ 5000ms for responsiveness', () => {
    const c = CUSTOMER_SUPPORT_PACT.conditions.find((x) => x.type === 'latency');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('lte');
    expect(c?.value as number).toBeLessThanOrEqual(5000);
  });

  it('enforces no cross-customer PII leakage', () => {
    const c = CUSTOMER_SUPPORT_PACT.conditions.find((x) => x.type === 'pii_handling');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('critical');
  });

  it('has strict toxicity threshold (< 0.05)', () => {
    const c = CUSTOMER_SUPPORT_PACT.conditions.find((x) => x.type === 'toxicity');
    expect(c).toBeDefined();
    expect(c?.operator).toBe('lt');
    expect(c?.value as number).toBeLessThan(0.05);
  });

  it('does not require escrow (customer support is not escrow-gated)', () => {
    expect(CUSTOMER_SUPPORT_PACT.escrowRequired).toBeFalsy();
  });
});
