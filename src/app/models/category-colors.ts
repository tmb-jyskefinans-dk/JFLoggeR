// Utility for consistent category color assignment across components
// Usage: getCategoryColor(category)

// Returns a CSS variable (defined per light/dark theme in styles.scss) from the CVI infographic palette.
// Most used groups get the most distinct hues: Udvikling Projekter = green, Små udviklingsopgaver = lilla,
// Support/drift = koral family. Bind with [style.*] (not SVG attributes) so var() resolves.
const CATEGORY_COLORS: Record<string, string> = {
  // Udvikling Projekter
  'Udvikling (prioriterede jf. projektoversigten)': 'var(--cat-dev-project)',
  'Estimering': 'var(--cat-estimering)',
  // Små Udviklingsopgaver
  'Udvikling (prioriterede opgaver)': 'var(--cat-small-dev)',
  // Support (ikke planlagt)
  'Vagtpostkasse/daglig drift': 'var(--cat-support)',
  'Vagtpostkasse/daglig drift - TFS': 'var(--cat-support-tfs)',
  'Vagtpostkasse/daglig drift - Jyffi': 'var(--cat-support-jyffi)',
  'Sparring/afklaringer med forretning': 'var(--cat-sparring)',
  'Eksterne systemer': 'var(--cat-external)',
  // Forretningsmæssig Drift (Planlagt)
  'Agile (daglig standup, planning, refinement, styring osv.)': 'var(--cat-agile)',
  'Div. forretningsmæssig drift (servicevinduer., o.l.)': 'var(--cat-ops)',
  // Team
  'Møder (ikke specifikke opgaver/projekter)': 'var(--cat-meetings)',
  'Ferie, afspadsering, sygdom': 'var(--cat-absence)',
  'Vidensdeling, research, uddannelse og tilegning af viden': 'var(--cat-knowledge)'
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? 'var(--cat-other)';
}
