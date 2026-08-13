import { describe, it, expect } from 'vitest';
import { formatBytes, formatIdleDays, barRatio, renderBar } from '../src/format.js';

describe('formatBytes', () => {
  it('0 bytes', () => expect(formatBytes(0)).toBe('0B'));
  it('under 1KB', () => expect(formatBytes(512)).toBe('512B'));
  it('KB', () => expect(formatBytes(2048)).toBe('2.0KB'));
  it('MB', () => expect(formatBytes(128 * 1024 * 1024)).toBe('128.0MB'));
  it('GB', () => expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0GB'));
  it('null -> placeholder', () => expect(formatBytes(null)).toBe('  —  '));
});

describe('formatIdleDays', () => {
  it('0 days', () => expect(formatIdleDays(0)).toBe('today'));
  it('1 day', () => expect(formatIdleDays(1)).toBe('1d'));
  it('45 days', () => expect(formatIdleDays(45)).toBe('45d'));
  it('365 days', () => expect(formatIdleDays(365)).toBe('365d'));
  it('null -> unknown', () => expect(formatIdleDays(null)).toBe('  ?  '));
});

describe('barRatio', () => {
  it('max is full', () => expect(barRatio(100, 100)).toBe(1));
  it('half', () => expect(barRatio(50, 100)).toBe(0.5));
  it('zero of max', () => expect(barRatio(0, 100)).toBe(0));
  it('max is 0 -> 0 (no divide-by-zero)', () => expect(barRatio(10, 0)).toBe(0));
  it('null size -> 0', () => expect(barRatio(null, 100)).toBe(0));
});

describe('renderBar', () => {
  it('full bar', () => expect(renderBar(1, 8)).toBe('████████'));
  it('half bar', () => expect(renderBar(0.5, 8)).toBe('████░░░░'));
  it('empty bar', () => expect(renderBar(0, 8)).toBe('░░░░░░░░'));
  it('rounds up partial cell', () => expect(renderBar(0.51, 8)).toBe('█████░░░'));
});
