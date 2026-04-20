export function preserveCategoryDescriptions(nextCategory: string, description: string, andetDescription: string): { description: string; andetDescription: string } {
  const normalized = (nextCategory || '').trim();
  const base = description || '';
  const other = andetDescription || '';

  if (normalized === 'Andet') {
    if (!other.trim() && base.trim()) {
      return { description: base, andetDescription: base };
    }
    return { description: base, andetDescription: other };
  }

  if (!base.trim() && other.trim()) {
    return { description: other, andetDescription: other };
  }

  return { description: base, andetDescription: other };
}
