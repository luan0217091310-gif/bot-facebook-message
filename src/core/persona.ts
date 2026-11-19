import { readFileSync } from 'node:fs';

export function createPersona(path: string): { get(): string } {
  const get = () => {
    const text = readFileSync(path, 'utf8').trim();
    if (!text) throw new Error('Persona file is empty');
    return text;
  };
  get(); // Fail at startup rather than on the first member's message.
  return { get };
}
