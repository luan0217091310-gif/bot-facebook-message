import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { createPersona } from '../src/core/persona.js';

it('reloads edited persona text and fails fast for missing/empty files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bothieu-persona-'));
  try {
    const path = join(dir, 'persona.md');
    expect(() => createPersona(path)).toThrow();
    writeFileSync(path, 'A'); const persona = createPersona(path);
    expect(persona.get()).toBe('A');
    writeFileSync(path, 'B'); expect(persona.get()).toBe('B');
    writeFileSync(path, '  '); expect(() => persona.get()).toThrow('empty');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
