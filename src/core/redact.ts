export function redact(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets.filter((s) => s.length >= 8).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[ĐÃ ẨN]');
  }
  return result
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/g, '[ĐÃ ẨN]')
    .replace(/\b(?:sk-|tvly-)[A-Za-z0-9_-]{10,}/g, '[ĐÃ ẨN]')
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[ĐÃ ẨN]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [ĐÃ ẨN]')
    .replace(/((?:password|passwd|pwd|mật khẩu|mat khau)\s*[:=]\s*)\S+/gi, '$1[ĐÃ ẨN]');
}
