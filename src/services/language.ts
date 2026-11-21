export function language(text:string,previous:'vi'|'en'='vi'):'vi'|'en' {
  if(/[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i.test(text))return 'vi';
  if(/\b(hello|hi|please|would|could|need|show|what|which|how|book|human|agent|thanks|help|can|yes|no|my|the|you|price|english)\b/i.test(text))return 'en';
  return previous;
}
