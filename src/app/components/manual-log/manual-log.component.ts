import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
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
export class ManualLogComponent {
  ipc = inject(IpcService);

  date = new Date().toISOString().slice(0,10);
  start = '08:00';
  end = '09:00';
  description = '';
  category = '';
  categoryGroups: CategoryGroup[] = CATEGORY_GROUPS;
  unmatchedCategory(): boolean {
    const c = this.category?.trim();
    if (!c) return false;
    return !this.categoryGroups.some(g => g.items.includes(c));
  }
  error = signal('');

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

    await this.ipc.submitPending(novel, this.description, this.category);
    // Refresh signals for the affected day so Today/Day/Summary views update instantly
    this.ipc.loadDay(this.date);
    this.description=''; this.category='';
  }
}
