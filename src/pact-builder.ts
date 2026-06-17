/**
 * PactBuilder — fluent builder for composing behavioral pacts.
 *
 * Start from a named template, then layer in deny rules (hard or soft)
 * and require rules. The built pact is a standard PactDefinition that
 * TrustNativeAgent / ArmaloAgent accepts, with per-action deny rules
 * attached for runtime enforcement.
 *
 * @example
 * ```typescript
 * import { PactBuilder } from 'armalo-agent';
 *
 * const pact = new PactBuilder()
 *   .from('SAFETY_DEFAULTS')
 *   .deny('tool:file_write', { pathMatches: /\/etc\//, enforcement: 'hard' })
 *   .deny('tool:http_request', { urlMatches: /prod\.internal/ })
 *   .require('citation_verified', { on: 'output:contains_url' })
 *   .build();
 * ```
 */

import { definePact } from '@armalo/core';
import type { PactDefinition } from '@armalo/core';
import { SAFETY_DEFAULTS, RESEARCH_PACT, CODING_PACT, CUSTOMER_SUPPORT_PACT } from './pacts/index.js';

export type PactTemplateName =
  | 'SAFETY_DEFAULTS'
  | 'RESEARCH_PACT'
  | 'CODING_PACT'
  | 'CUSTOMER_SUPPORT_PACT';

export interface DenyOptions {
  /** Block calls where the `path`/`filePath` param matches this pattern. */
  pathMatches?: RegExp | string;
  /** Block calls where the `url`/`endpoint` param matches this pattern. */
  urlMatches?: RegExp | string;
  /** Block calls where arbitrary named params match their patterns. */
  paramMatches?: Record<string, RegExp | string>;
  /**
   * 'hard' (default) — block the tool call before execution, return an error result.
   * 'soft' — log a warning and allow the call through.
   */
  enforcement?: 'hard' | 'soft';
}

export interface RequireOptions {
  /** Trigger condition — e.g. 'output:contains_url', 'tool:called:web_search'. */
  on?: string;
  /** 'hard' — throw on violation. 'soft' (default) — log and continue. */
  enforcement?: 'hard' | 'soft';
}

export interface DenyRule {
  toolPattern: string;
  pathMatches?: RegExp | string;
  urlMatches?: RegExp | string;
  paramMatches?: Record<string, RegExp | string>;
  enforcement: 'hard' | 'soft';
}

export interface RequireRule {
  conditionName: string;
  on?: string;
  enforcement: 'hard' | 'soft';
}

/** A PactDefinition augmented with runtime enforcement rules from PactBuilder. */
export type BuiltPact = PactDefinition & {
  readonly _denyRules: readonly DenyRule[];
  readonly _requireRules: readonly RequireRule[];
};

export function isBuiltPact(pact: PactDefinition | undefined | null): pact is BuiltPact {
  return !!pact && '_denyRules' in pact;
}

/** Check whether a deny rule matches a specific tool call. */
export function matchesDenyRule(
  rule: DenyRule,
  toolName: string,
  toolInput: Record<string, unknown>,
): boolean {
  const pattern = rule.toolPattern;

  // Match: 'tool:file_write', 'tool:*', 'file_write', '*'
  const toolSegment = pattern.startsWith('tool:') ? pattern.slice(5) : pattern;
  const toolMatches = toolSegment === '*' || toolName === toolSegment || toolName === pattern;
  if (!toolMatches) return false;

  if (rule.pathMatches) {
    const pathValue = String(toolInput['path'] ?? toolInput['filePath'] ?? toolInput['file'] ?? '');
    const re = rule.pathMatches instanceof RegExp ? rule.pathMatches : new RegExp(rule.pathMatches);
    if (!re.test(pathValue)) return false;
  }

  if (rule.urlMatches) {
    const urlValue = String(toolInput['url'] ?? toolInput['endpoint'] ?? toolInput['uri'] ?? '');
    const re = rule.urlMatches instanceof RegExp ? rule.urlMatches : new RegExp(rule.urlMatches);
    if (!re.test(urlValue)) return false;
  }

  if (rule.paramMatches) {
    for (const [param, matcher] of Object.entries(rule.paramMatches)) {
      const paramValue = String(toolInput[param] ?? '');
      const re = matcher instanceof RegExp ? matcher : new RegExp(matcher);
      if (!re.test(paramValue)) return false;
    }
  }

  return true;
}

const TEMPLATES: Record<PactTemplateName, PactDefinition> = {
  SAFETY_DEFAULTS,
  RESEARCH_PACT,
  CODING_PACT,
  CUSTOMER_SUPPORT_PACT,
};

export class PactBuilder {
  private _name = 'custom-pact';
  private _description = '';
  private _category = 'custom';
  private _conditions: PactDefinition['conditions'] = [];
  private _denyRules: DenyRule[] = [];
  private _requireRules: RequireRule[] = [];

  /** Load a predefined template as the base. Stacks with subsequent rules. */
  from(templateName: PactTemplateName): this {
    const template = TEMPLATES[templateName];
    if (!template) {
      throw new Error(
        `Unknown pact template: "${templateName}". Valid: ${Object.keys(TEMPLATES).join(', ')}`,
      );
    }
    this._name = template.name;
    this._description = template.description ?? '';
    this._category = template.category ?? 'custom';
    this._conditions = [...template.conditions];
    return this;
  }

  /** Override the pact name and optional metadata. */
  named(name: string, opts: { description?: string; category?: string } = {}): this {
    this._name = name;
    if (opts.description) this._description = opts.description;
    if (opts.category) this._category = opts.category;
    return this;
  }

  /**
   * Add a tool prohibition clause.
   *
   * Pattern formats:
   * - 'tool:file_write'  — match by tool name (with prefix)
   * - 'file_write'       — match by tool name (without prefix)
   * - 'tool:*'           — match all tool calls
   *
   * Constraint options narrow the match: if pathMatches is provided, only
   * tool calls where the `path` parameter matches the pattern are blocked.
   */
  deny(toolPattern: string, opts: DenyOptions = {}): this {
    const enforcement = opts.enforcement ?? 'hard';
    const rule: DenyRule = {
      toolPattern,
      pathMatches: opts.pathMatches,
      urlMatches: opts.urlMatches,
      paramMatches: opts.paramMatches,
      enforcement,
    };
    this._denyRules.push(rule);

    const descParts = [`Deny ${toolPattern}`];
    if (opts.pathMatches) descParts.push(`where path matches ${String(opts.pathMatches)}`);
    if (opts.urlMatches) descParts.push(`where url matches ${String(opts.urlMatches)}`);

    this._conditions.push({
      type: 'tool_restriction',
      operator: 'excludes',
      value: toolPattern,
      severity: enforcement === 'hard' ? 'critical' : 'major',
      verificationMethod: 'heuristic',
      description: descParts.join(' '),
    });

    return this;
  }

  /**
   * Add a required behavior clause.
   *
   * @param conditionName - e.g. 'citation_verified', 'human_review', 'output_grounded'
   * @param opts.on - trigger qualifier, e.g. 'output:contains_url'
   */
  require(conditionName: string, opts: RequireOptions = {}): this {
    const enforcement = opts.enforcement ?? 'soft';
    this._requireRules.push({ conditionName, on: opts.on, enforcement });

    this._conditions.push({
      type: conditionName,
      operator: 'eq',
      value: true,
      severity: enforcement === 'hard' ? 'critical' : 'major',
      verificationMethod: 'jury',
      description: `Require ${conditionName}${opts.on ? ` on ${opts.on}` : ''}`,
    });

    return this;
  }

  /** Build and return the final pact with attached enforcement rules. */
  build(): BuiltPact {
    const base = definePact({
      name: this._name || 'custom-pact',
      description: this._description,
      category: this._category,
      conditions: this._conditions,
    });

    return Object.assign({}, base, {
      _denyRules: Object.freeze([...this._denyRules]) as readonly DenyRule[],
      _requireRules: Object.freeze([...this._requireRules]) as readonly RequireRule[],
    }) as BuiltPact;
  }
}
