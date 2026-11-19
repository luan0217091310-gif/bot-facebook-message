/** Split text into parts of at most `max` chars, preferring to cut right after the last newline. */
export function splitMessage(text: string, max = 4000): string[] {
  if (!Number.isInteger(max) || max < 2) throw new Error('max must be an integer >= 2');
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const nl = rest.lastIndexOf('\n', max - 1);
    let cut = nl >= 0 ? nl + 1 : max;
    // Do not split a UTF-16 surrogate pair (emoji) between messages.
    const last = rest.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}
