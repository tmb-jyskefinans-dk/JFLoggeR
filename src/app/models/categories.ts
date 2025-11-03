export interface CategoryGroup { label: string; items: string[]; }

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    label: 'Team',
    items: [
      'Møder (ikke specifikke opgaver/projekter)',
      'Ferie, afspadsering, sygdom',
      'Vidensdeling, research, uddannelse og tilegning af viden'
    ]
  },
  {
    label: 'Forretningsmæssig Drift (Planlagt)',
    items: [
      'Agile (daglig standup, planning, refinement, styring osv.)',
      'Div. forretningsmæssig drift (servicevinduer., o.l.)'
    ]
  },
  {
    label: 'Support (ikke planlagt)',
    items: [
      'Vagtpostkasse/daglig drift',
      'Vagtpostkasse/daglig drift - TFS',
      'Vagtpostkasse/daglig drift - Jyffi',
      'Sparring/afklaringer med forretning',
      'Eksterne systemer'
    ]
  },
  {
    label: 'Små Udviklingsopgaver',
    items: [
      'Udvikling (prioriterede opgaver)',
      'Estimering'
    ]
  },
  {
    label: 'Udvikling Projekter',
    items: [
      'Udvikling (prioriterede jf. projektoversigten)',
      'Estimering'
    ]
  },

];
