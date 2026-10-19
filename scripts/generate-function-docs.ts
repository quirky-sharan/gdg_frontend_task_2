/**
 * Generates docs/FUNCTIONS.md from the function registry, so the documentation
 * can never drift from the implementation: `npm run docs:functions`.
 * A unit test fails if the committed file is out of date.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderFunctionDocs } from './function-docs';

const target = fileURLToPath(new URL('../docs/FUNCTIONS.md', import.meta.url));
writeFileSync(target, renderFunctionDocs());
console.log(`Wrote ${target}`);
