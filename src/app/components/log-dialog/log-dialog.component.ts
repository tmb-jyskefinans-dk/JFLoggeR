import { Component, OnInit, AfterViewInit, inject, signal, ChangeDetectionStrategy, output, ViewChild, ElementRef } from '@angular/core';
import { CATEGORY_GROUPS, CategoryGroup } from '../../models/categories';
import { IpcService } from '../../services/ipc.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'log-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './log-dialog.component.html',
  styleUrls: ['./log-dialog.component.scss'],
  host: {
    'class': 'contents'
  }
})
export class LogDialogComponent implements OnInit, AfterViewInit {
  closed = output<void>();

  ipc = inject(IpcService);

  showAll = false;
  allSlots = this.ipc.pendingSlots;
  recent = this.ipc.recent;

  selectedSlots = signal<string[]>([]);
  description = '';
  category = '';
  categoryGroups: CategoryGroup[] = CATEGORY_GROUPS;
  unmatchedCategory(): boolean {
    const c = this.category?.trim();
    if (!c) return false;
    return !this.categoryGroups.some(g => g.items.includes(c));
  }

  @ViewChild('descInput') descInput?: ElementRef<HTMLInputElement>;

  ngOnInit() {
    const list = this.ipc.pendingSlots();
    this.selectedSlots.set(list.slice(0, 1));
    if (!this.recent().length) this.ipc.loadRecent();
  }

  ngAfterViewInit() {
    queueMicrotask(() => this.descInput?.nativeElement.focus());
  }

  toggle(s: string) {
    const set = new Set(this.selectedSlots());
    set.has(s) ? set.delete(s) : set.add(s);
    this.selectedSlots.set(Array.from(set).sort());
  }
  remove(i: number) {
    const next = [...this.selectedSlots()];
    next.splice(i, 1);
    this.selectedSlots.set(next);
  }
  applyPreset(v: string) {
    const [desc, cat] = v.split('||');
    if (desc) this.description = desc;
    if (cat) this.category = cat;
  }
  async submit() {
    const slots = this.selectedSlots();
    await this.ipc.submitPending(slots, this.description, this.category);
    // Derive affected day from first slot and trigger reload of day & summary signals
    if (slots.length) {
      const day = slots[0].split('T')[0];
      this.ipc.loadDay(day);
    }
    this.description = ''; this.category = ''; this.selectedSlots.set([]);
    this.closed.emit();
  }
}
