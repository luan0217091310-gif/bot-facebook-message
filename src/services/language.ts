const VI_DIACRITICS = /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i;
const VI_UNACCENTED = /\b(xin chao|chao|cam on|dat lich|tu van|bao gia|bao nhieu|nhac minh|giup minh|giup toi|khong|duoc|toi|ban|minh|nhe|nha|vui long|lien he|nhan vien|the nao|o dau|xem du lieu|xoa du lieu|dong y|huy)\b/i;
const EN_WORDS = /\b(hello|hi|hey|good|morning|afternoon|evening|please|thank|thanks|would|could|should|need|want|show|what|which|how|where|when|who|why|book|appointment|schedule|remind|reminder|human|staff|agent|help|support|can|yes|no|my|your|our|the|this|that|you|price|cost|service|english|summary|summarize|document|file|delete|cancel|confirm|info|information|sorry|okay|bye|goodbye)\b/i;

/** Phát hiện ngôn ngữ Việt/Anh, giữ nguyên ngôn ngữ trước đó với lệnh slash thuần túy. */
export function language(text: string, previous: 'vi' | 'en' = 'vi'): 'vi' | 'en' {
  const trimmed = text.trim();
  if (/^(?:\/lang\s+en|english(?:\s+please)?|switch\s+to\s+english)$/i.test(trimmed)) return 'en';
  if (/^(?:\/lang\s+vi|ti[eêế]ng\s+vi[eệ]t|n[oó]i\s+ti[eêế]ng\s+vi[eệ]t)$/i.test(trimmed)) return 'vi';
  // Bỏ phần tên lệnh (/help, /book, ...) để không nhận nhầm từ tiếng Anh trong tên lệnh.
  const sample = trimmed.startsWith('/') ? trimmed.replace(/^\/\S+\s*/, '') : trimmed;
  if (!sample) return previous;
  if (VI_DIACRITICS.test(sample)) return 'vi';
  if (VI_UNACCENTED.test(sample)) return 'vi';
  if (EN_WORDS.test(sample)) return 'en';
  return previous;
}
