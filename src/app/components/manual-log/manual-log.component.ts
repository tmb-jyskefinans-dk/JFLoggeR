import { Component, inject, signal, ChangeDetectionStrategy, input, output, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CATEGORY_GROUPS, CategoryGroup } from '../../models/categories';
import { IpcService } from '../../services/ipc.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'manual-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './manual-log.component.html',
  styleUrls: ['./manual-log.component.scss']
})
export class ManualLogComponent implements OnInit {
  ipc = inject(IpcService);
  private router = inject(Router);

  date = new Date().toISOString().slice(0,10);
  start = '08:00';
  end = '09:00';
  description = '';
  category = '';
  andetDescription = '';
  // Removed suggestion feature: no predictive category logic.
  categoryGroups: CategoryGroup[] = CATEGORY_GROUPS;
  recent = this.ipc.recent; // recent reusable descriptions/categories
  unmatchedCategory(): boolean {
    const c = this.category?.trim();
    if (!c) return false;
    return !this.categoryGroups.some(g => g.items.includes(c));
  }
  error = signal('');

  // Dialog integration: when rendered inside a modal overlay
  dialogMode = input<boolean>(false);
  closed = output<void>();
  initialDate = input<string>('');

  async submit() {
    this.error.set('');
    const [sh,sm] = this.start.split(':').map(Number);
    const [eh,em] = this.end.split(':').map(Number);
    const startMin = sh*60+sm, endMin = eh*60+em;
    if (endMin <= startMin) { this.error.set('End must be after start'); return; }

    const slot = this.ipc.settings()?.slot_minutes ?? 15;
    const slots: string[] = [];
    for (let m = Math.floor(startMin/slot)*slot; m < endMin; m += slot) {
      const h = Math.floor(m/60), mm = m%60;
      slots.push(`${this.date}T${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`);
    }
    const dayEntries = await window.workApi.getDayEntries(this.date);
    const done = new Set(dayEntries.map((e:any)=> `${e.day}T${e.start}`));
    const novel = slots.filter(k => !done.has(k));
    if (!novel.length) { this.error.set('No new slots to save.'); return; }

    let finalDescription = this.description;
    if (this.category === 'Andet' && this.andetDescription.trim()) {
      finalDescription = this.andetDescription.trim();
    }
    await this.ipc.submitPending(novel, finalDescription, this.category);
    // Refresh signals for the affected day so Today/Day/Summary views update instantly
    this.ipc.loadDay(this.date);
    this.description=''; this.category=''; this.andetDescription='';
    if (!this.dialogMode()) {
      // Page mode: navigate to summary view for the date with snackbar notification state
      try {
        this.router.navigate(['/summary', this.date], { state: { snackbar: 'Manuel registrering tilføjet' }});
      } catch { /* navigation errors ignored */ }
    } else {
      // Dialog mode: simply close
      this.closed.emit();
    }
  }

  ngOnInit() {
    // Prefill date if initialDate provided (dialog mode usage)
    const d = this.initialDate();
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      this.date = d;
    }
  }

  applyPreset(v: string) {
    if (!v) return;
    const [desc, cat] = v.split('||');
    if (cat === 'Andet') {
      this.category = 'Andet';
      if (desc) {
        this.andetDescription = desc;
        this.description = '';
      }
    } else {
      if (desc) this.description = desc;
      if (cat) this.category = cat;
      if (this.category !== 'Andet') this.andetDescription = '';
    }
  }

}

// --- Pure helpers exported for test coverage without Angular DI complexity ---
/** Build slot keys for a manual interval given start/end HH:MM inclusive of start and exclusive of end, aligned to slot length. */
export function buildSlotKeys(date: string, start: string, end: string, slotMinutes: number): string[] {
  const [sh,sm] = start.split(':').map(Number);
  const [eh,em] = end.split(':').map(Number);
  const startMin = sh*60+sm, endMin = eh*60+em;
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin || slotMinutes <= 0) return [];
  const list: string[] = [];
  const first = Math.floor(startMin/slotMinutes)*slotMinutes;
  for (let m = first; m < endMin; m += slotMinutes) {
    const h = Math.floor(m/60), mm = m%60;
    list.push(`${date}T${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`);
  }
  return list;
}
/** Return only slots not present in existing day entry keys ("YYYY-MM-DDTHH:MM"). */
export function filterNovelSlots(slotKeys: string[], existing: string[]): string[] {
  const done = new Set(existing);
  return slotKeys.filter(k => !done.has(k));
}
/** Prefill date logic used by component; returns validated date or fallback. */
export function prefillDate(initialDate: string, fallback: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : fallback;
}
/** Decide whether submit should emit closed (dialog mode) or navigate (page mode). */
export function shouldEmitClosed(dialogMode: boolean): boolean { return !!dialogMode; }
