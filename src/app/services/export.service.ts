import { Injectable, inject } from '@angular/core';
import { IpcService } from './ipc.service';

// Lightweight Excel export service using SheetJS (xlsx).
// Creates three sheets: Entries, CategoryTotals, RootGroupTotals.
// Falls back gracefully if library fails to load.
@Injectable({ providedIn: 'root' })
export class ExportService {
  ipc = inject(IpcService);

  async exportDaySummary(day: string) {
    // Dynamic import to avoid adding xlsx to initial bundle.
  // Typed dynamic import; SheetJS ships its own TypeScript definitions.
  let XLSX: typeof import('xlsx');
    try {
      XLSX = await import('xlsx');
    } catch (err) {
      console.error('[export] Failed to load xlsx lib', err);
      return { ok: false, error: 'xlsx-load-failed' };
    }

    const rows = this.ipc.summary();
    const categoryTotals = (this.ipc as any).categoryTotals?.() ?? []; // if exposed publicly later
    // Recompute category totals locally if not accessible
    const catMap = new Map<string, { category: string; slots: number; minutes: number }>();
    if (!categoryTotals.length) {
      for (const r of rows) {
        const prev = catMap.get(r.category);
        if (prev) { prev.slots += r.slots; prev.minutes += r.minutes; }
        else catMap.set(r.category, { category: r.category, slots: r.slots, minutes: r.minutes });
      }
    }
  const catTotals: { category: string; slots: number; minutes: number }[] = categoryTotals.length ? categoryTotals : Array.from(catMap.values());

    // Root group totals require CATEGORY_GROUPS mapping (duplicate minimal logic here to avoid direct access)
    // It's acceptable duplication for now; consider refactoring if needed.
    let CATEGORY_GROUPS: any[] = [];
    try { CATEGORY_GROUPS = (await import('../models/categories')).CATEGORY_GROUPS; } catch {}
    const groupMap = new Map<string, { label: string; slots: number; minutes: number }>();
    const catToGroup = new Map<string, string>();
    for (const g of CATEGORY_GROUPS) { for (const c of g.items) catToGroup.set(c, g.label); }
    for (const r of rows) {
      const grp = catToGroup.get(r.category) || 'Andet';
      const prev = groupMap.get(grp);
      if (prev) { prev.slots += r.slots; prev.minutes += r.minutes; }
      else groupMap.set(grp, { label: grp, slots: r.slots, minutes: r.minutes });
    }
    const groupTotals = Array.from(groupMap.values());

    // Sheet 1: Individual entries
    const entrySheetData = [
      ['Day', 'Description', 'Category', 'Slots', 'Minutes'],
      ...rows.map(r => [day, r.description, r.category, r.slots, r.minutes])
    ];
    const wsEntries = XLSX.utils.aoa_to_sheet(entrySheetData);

    // Sheet 2: Category totals
    const catSheetData = [
      ['Category', 'Slots', 'Minutes'],
      ...catTotals.map(c => [c.category, c.slots, c.minutes])
    ];
    const wsCats = XLSX.utils.aoa_to_sheet(catSheetData);

    // Sheet 3: Root group totals
    const groupSheetData = [
      ['Group', 'Slots', 'Minutes'],
      ...groupTotals.map(g => [g.label, g.slots, g.minutes])
    ];
    const wsGroups = XLSX.utils.aoa_to_sheet(groupSheetData);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsEntries, 'Entries');
    XLSX.utils.book_append_sheet(wb, wsCats, 'CategoryTotals');
    XLSX.utils.book_append_sheet(wb, wsGroups, 'RootGroupTotals');

    const arrayBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arrayBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const filename = `worklog-summary-${day}.xlsx`;
    // Trigger download in browser context
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
    return { ok: true, filename };
  }
}
