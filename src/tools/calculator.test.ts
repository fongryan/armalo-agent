import { describe, it, expect } from 'vitest';
import { calculatorTool } from './calculator.js';

type CalcResult = { expression: string; result: number; type: string };

async function calc(expression: string): Promise<CalcResult> {
  return calculatorTool.execute({ expression }) as Promise<CalcResult>;
}

describe('calculatorTool', () => {
  describe('basic arithmetic', () => {
    it('adds two integers', async () => {
      const { result } = await calc('1 + 2');
      expect(result).toBe(3);
    });

    it('subtracts', async () => {
      const { result } = await calc('10 - 4');
      expect(result).toBe(6);
    });

    it('multiplies', async () => {
      const { result } = await calc('3 * 7');
      expect(result).toBe(21);
    });

    it('divides', async () => {
      const { result } = await calc('15 / 4');
      expect(result).toBeCloseTo(3.75);
    });

    it('respects operator precedence (* over +)', async () => {
      const { result } = await calc('2 + 3 * 4');
      expect(result).toBe(14);
    });

    it('respects parentheses', async () => {
      const { result } = await calc('(2 + 3) * 4');
      expect(result).toBe(20);
    });

    it('handles nested parentheses', async () => {
      const { result } = await calc('((2 + 3) * (4 - 1)) / 3');
      expect(result).toBe(5);
    });

    it('handles unary minus on a literal', async () => {
      const { result } = await calc('-5 + 10');
      expect(result).toBe(5);
    });

    it('handles double unary minus', async () => {
      const { result } = await calc('--5');
      expect(result).toBe(5);
    });

    it('handles unary minus inside parentheses', async () => {
      const { result } = await calc('(-3) * 4');
      expect(result).toBe(-12);
    });

    it('computes modulo', async () => {
      const { result } = await calc('17 % 5');
      expect(result).toBe(2);
    });

    it('computes ** exponentiation', async () => {
      const { result } = await calc('2 ** 10');
      expect(result).toBe(1024);
    });

    it('exponentiation is right-associative (2**3**2 = 2**9)', async () => {
      const { result } = await calc('2 ** 3 ** 2');
      expect(result).toBe(512);
    });

    it('handles decimal numbers', async () => {
      const { result } = await calc('1.5 + 2.5');
      expect(result).toBe(4);
    });

    it('ignores extra whitespace', async () => {
      const { result } = await calc('  10  +  5  ');
      expect(result).toBe(15);
    });

    it('handles zero', async () => {
      const { result } = await calc('0 + 0');
      expect(result).toBe(0);
    });

    it('handles large numbers', async () => {
      const { result } = await calc('1000000 * 1000000');
      expect(result).toBe(1_000_000_000_000);
    });
  });

  describe('math functions', () => {
    it('sqrt(144) = 12', async () => {
      const { result } = await calc('sqrt(144)');
      expect(result).toBe(12);
    });

    it('sqrt(2) is irrational', async () => {
      const { result } = await calc('sqrt(2)');
      expect(result).toBeCloseTo(1.4142135);
    });

    it('abs of negative number', async () => {
      const { result } = await calc('abs(-42)');
      expect(result).toBe(42);
    });

    it('abs of positive number is unchanged', async () => {
      const { result } = await calc('abs(7)');
      expect(result).toBe(7);
    });

    it('floor rounds down', async () => {
      const { result } = await calc('floor(3.9)');
      expect(result).toBe(3);
    });

    it('ceil rounds up', async () => {
      const { result } = await calc('ceil(3.1)');
      expect(result).toBe(4);
    });

    it('round to nearest integer', async () => {
      const { result } = await calc('round(3.5)');
      expect(result).toBe(4);
    });

    it('log(1) = 0 (natural log)', async () => {
      const { result } = await calc('log(1)');
      expect(result).toBe(0);
    });

    it('log10(100) = 2', async () => {
      const { result } = await calc('log10(100)');
      expect(result).toBeCloseTo(2);
    });

    it('log2(8) = 3', async () => {
      const { result } = await calc('log2(8)');
      expect(result).toBeCloseTo(3);
    });

    it('sin(0) = 0', async () => {
      const { result } = await calc('sin(0)');
      expect(result).toBe(0);
    });

    it('cos(0) = 1', async () => {
      const { result } = await calc('cos(0)');
      expect(result).toBe(1);
    });

    it('exp(0) = 1', async () => {
      const { result } = await calc('exp(0)');
      expect(result).toBe(1);
    });

    it('sign(-5) = -1', async () => {
      const { result } = await calc('sign(-5)');
      expect(result).toBe(-1);
    });

    it('nested function: sqrt(abs(-9)) = 3', async () => {
      const { result } = await calc('sqrt(abs(-9))');
      expect(result).toBe(3);
    });

    it('function with expression argument: sqrt(9 + 16) = 5', async () => {
      const { result } = await calc('sqrt(9 + 16)');
      expect(result).toBe(5);
    });

    it('function combined with operators: sqrt(144) + 2**10', async () => {
      const { result } = await calc('sqrt(144) + 2**10');
      expect(result).toBe(1036);
    });
  });

  describe('error handling', () => {
    it('throws on division by zero', async () => {
      await expect(calc('1 / 0')).rejects.toThrow('Division by zero');
    });

    it('throws on unknown function name', async () => {
      await expect(calc('badFunc(5)')).rejects.toThrow('Unknown function');
    });

    it('throws on unexpected character @', async () => {
      await expect(calc('5 @ 3')).rejects.toThrow('Unexpected character');
    });

    it('throws on unclosed parenthesis', async () => {
      await expect(calc('(5 + 3')).rejects.toThrow();
    });

    it('throws on unmatched closing parenthesis', async () => {
      await expect(calc('5 + 3)')).rejects.toThrow();
    });

    it('throws on empty expression (whitespace only)', async () => {
      await expect(calc('   ')).rejects.toThrow();
    });

    it('wraps error with original expression', async () => {
      await expect(calc('1 / 0')).rejects.toThrow('"1 / 0"');
    });
  });

  describe('tool interface', () => {
    it('has the correct tool name', () => {
      expect(calculatorTool.name).toBe('calculator');
    });

    it('has a non-empty description', () => {
      expect(calculatorTool.description.length).toBeGreaterThan(10);
    });

    it('input_schema requires expression', () => {
      expect(calculatorTool.input_schema.required).toContain('expression');
    });

    it('input_schema expression property is a string type', () => {
      const prop = calculatorTool.input_schema.properties['expression'] as { type: string };
      expect(prop?.type).toBe('string');
    });

    it('echoes expression in result', async () => {
      const result = await calculatorTool.execute({ expression: '2 + 2' }) as CalcResult;
      expect(result.expression).toBe('2 + 2');
    });

    it('result type field is "number"', async () => {
      const result = await calculatorTool.execute({ expression: '1' }) as CalcResult;
      expect(result.type).toBe('number');
    });

    it('coerces non-string expression inputs via String()', async () => {
      const result = await calculatorTool.execute({ expression: 42 }) as CalcResult;
      expect(result.result).toBe(42);
    });
  });
});
