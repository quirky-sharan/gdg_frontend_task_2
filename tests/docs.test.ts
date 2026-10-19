import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderFunctionDocs } from '../scripts/function-docs';

describe('documentation', () => {
  it('docs/FUNCTIONS.md is up to date with the function registry (run `npm run docs:functions`)', () => {
    const committed = readFileSync(new URL('../docs/FUNCTIONS.md', import.meta.url), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(renderFunctionDocs());
  });
});
