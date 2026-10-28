// Utility for consistent category color assignment across components
// Usage: getCategoryColor(category)

// Most used groups get the most distinct hues: Udvikling Projekter = blue, Små udviklingsopgaver = emerald,
// Support/drift = orange family. Other groups use hue families that do not clash with those three.
const CATEGORY_COLORS: Record<string, string> = {
  // Udvikling Projekter
  'Udvikling (prioriterede jf. projektoversigten)': '#3B82F6',
  'Estimering': '#22D3EE',
  // Små Udviklingsopgaver
  'Udvikling (prioriterede opgaver)': '#10B981',
  // Support (ikke planlagt)
  'Vagtpostkasse/daglig drift': '#F97316',
  'Vagtpostkasse/daglig drift - TFS': '#F59E0B',
  'Vagtpostkasse/daglig drift - Jyffi': '#EAB308',
  'Sparring/afklaringer med forretning': '#EF4444',
  'Eksterne systemer': '#FB7185',
  // Forretningsmæssig Drift (Planlagt)
  'Agile (daglig standup, planning, refinement, styring osv.)': '#D946EF',
  'Div. forretningsmæssig drift (servicevinduer., o.l.)': '#F0ABFC',
  // Team
  'Møder (ikke specifikke opgaver/projekter)': '#8B5CF6',
  'Ferie, afspadsering, sygdom': '#94A3B8',
  'Vidensdeling, research, uddannelse og tilegning af viden': '#84CC16'
};

// Ad-hoc categories (Import, Andet, …) get muted tones so they never look like the main ones.
const FALLBACK_PALETTE = ['#64748B', '#A8A29E', '#78716C', '#9CA3AF', '#71717A'];

export function getCategoryColor(category: string): string {
  const known = CATEGORY_COLORS[category];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = category.charCodeAt(i) + ((hash << 5) - hash);
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}
