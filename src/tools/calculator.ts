import type { Tool } from '../types.js';

/**
 * Safe mathematical calculator — evaluates arithmetic expressions
 * without using eval(). Supports +, -, *, /, **, %, parentheses,
 * and common math functions (sqrt, abs, floor, ceil, round, log, sin, cos, tan).
 */
export const calculatorTool: Tool = {
  name: 'calculator',
  description: 'Evaluate mathematical expressions safely. Supports arithmetic, percentages, and common math functions like sqrt, abs, round, log, sin, cos.',
  input_schema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The mathematical expression to evaluate, e.g. "sqrt(144) + 2^10" or "(42 * 1.08) / 12"',
      },
    },
    required: ['expression'],
  },
  async execute({ expression }: Record<string, unknown>) {
    const expr = String(expression).trim();
    try {
      const result = evaluate(expr);
      return { expression: expr, result, type: typeof result };
    } catch (err) {
      throw new Error(`Cannot evaluate "${expr}": ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// Safe expression evaluator — no eval(), no new Function()
function evaluate(expr: string): number {
  const tokens = tokenize(expr);
  const [result] = parseExpr(tokens, 0);
  return result;
}

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'fn'; value: string } | { type: 'paren'; value: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (!ch) break;
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i] ?? '')) num += expr[i++];
      tokens.push({ type: 'num', value: parseFloat(num) });
    } else if (/[a-z]/i.test(ch)) {
      let fn = '';
      while (i < expr.length && /[a-z]/i.test(expr[i] ?? '')) fn += expr[i++];
      tokens.push({ type: 'fn', value: fn.toLowerCase() });
    } else if ('+-*/%^'.includes(ch) || (ch === '*' && expr[i + 1] === '*')) {
      if (ch === '*' && expr[i + 1] === '*') { tokens.push({ type: 'op', value: '**' }); i += 2; }
      else { tokens.push({ type: 'op', value: ch }); i++; }
    } else if ('()'.includes(ch)) {
      tokens.push({ type: 'paren', value: ch }); i++;
    } else {
      throw new Error(`Unexpected character: ${ch}`);
    }
  }
  return tokens;
}

const MATH_FNS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, log: Math.log, log2: Math.log2, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, sign: Math.sign,
};

function parseExpr(tokens: Token[], pos: number): [number, number] {
  return parseAddSub(tokens, pos);
}

function parseAddSub(tokens: Token[], pos: number): [number, number] {
  let [left, p] = parseMulDiv(tokens, pos);
  while (p < tokens.length) {
    const tok = tokens[p];
    if (!tok || tok.type !== 'op' || (tok.value !== '+' && tok.value !== '-')) break;
    const op = tok.value;
    let right: number;
    [right, p] = parseMulDiv(tokens, p + 1);
    left = op === '+' ? left + right : left - right;
  }
  return [left, p];
}

function parseMulDiv(tokens: Token[], pos: number): [number, number] {
  let [left, p] = parsePow(tokens, pos);
  while (p < tokens.length) {
    const tok = tokens[p];
    if (!tok || tok.type !== 'op' || !['*', '/', '%'].includes(tok.value)) break;
    const op = tok.value;
    let right: number;
    [right, p] = parsePow(tokens, p + 1);
    if (op === '*') left *= right;
    else if (op === '/') { if (right === 0) throw new Error('Division by zero'); left /= right; }
    else left %= right;
  }
  return [left, p];
}

function parsePow(tokens: Token[], pos: number): [number, number] {
  let [base, p] = parseUnary(tokens, pos);
  if (p < tokens.length && tokens[p]?.type === 'op' && tokens[p]?.value === '**') {
    let exp: number;
    [exp, p] = parsePow(tokens, p + 1);
    base = Math.pow(base, exp);
  }
  return [base, p];
}

function parseUnary(tokens: Token[], pos: number): [number, number] {
  const tok = tokens[pos];
  if (tok?.type === 'op' && tok.value === '-') {
    const [val, p] = parseUnary(tokens, pos + 1);
    return [-val, p];
  }
  return parseAtom(tokens, pos);
}

function parseAtom(tokens: Token[], pos: number): [number, number] {
  const tok = tokens[pos];
  if (!tok) throw new Error('Unexpected end of expression');

  if (tok.type === 'num') return [tok.value, pos + 1];

  if (tok.type === 'fn') {
    const fn = MATH_FNS[tok.value];
    if (!fn) throw new Error(`Unknown function: ${tok.value}`);
    if (tokens[pos + 1]?.value !== '(') throw new Error(`Expected ( after ${tok.value}`);
    const [arg, p] = parseExpr(tokens, pos + 2);
    if (tokens[p]?.value !== ')') throw new Error(`Expected ) after ${tok.value} argument`);
    return [fn(arg), p + 1];
  }

  if (tok.type === 'paren' && tok.value === '(') {
    const [val, p] = parseExpr(tokens, pos + 1);
    if (tokens[p]?.value !== ')') throw new Error('Expected closing )');
    return [val, p + 1];
  }

  throw new Error(`Unexpected token: ${JSON.stringify(tok)}`);
}
