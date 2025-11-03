// Utility for consistent category color assignment across components
// Usage: getCategoryColor(category, index)

const PALETTE = [
  '#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#0EA5E9','#84CC16','#D946EF','#F43F5E'
];

// Optionally, pass in a category list to ensure stable color assignment
export function getCategoryColor(category: string, categories?: string[]): string {
  if (categories) {
    const idx = categories.indexOf(category);
    return PALETTE[idx >= 0 ? idx % PALETTE.length : 0];
  }
  // fallback: hash category string
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = category.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
