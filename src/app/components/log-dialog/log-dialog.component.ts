import { Component, OnInit, AfterViewInit, inject, signal, ChangeDetectionStrategy, output, ViewChild, ElementRef, computed, effect } from '@angular/core';
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
  // Parsed slot objects for improved readability in template
  private weekdayNames = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
  slotList = computed(() => this.allSlots().map(k => {
    const [day, time] = k.split('T');
    const [y,m,d] = day.split('-').map(Number);
    const dt = new Date(y, (m||1)-1, d||1);
    const weekday = this.weekdayNames[dt.getDay()];
    return { key: k, day, time, weekday };
  }));
  recent = this.ipc.recent;

  selectedSlots = signal<string[]>([]);
  allSelected = computed(() => {
    const all = this.allSlots();
    const selected = this.selectedSlots();
    return all.length > 0 && selected.length === all.length && all.every(s => selected.includes(s));
  });
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
    const promptSlot = this.ipc.lastPromptSlot ? this.ipc.lastPromptSlot() : null;
    console.log(promptSlot, list);
    if (promptSlot && list.includes(promptSlot)) {
      // Prefer the slot that triggered the dialog
      this.selectedSlots.set([promptSlot]);
    } else if (list.length) {
      // Fallback: first pending slot
      this.selectedSlots.set(list.slice(0, 1));
    }
    this.ipc.loadRecent();
  }

  ngAfterViewInit() {
    queueMicrotask(() => this.descInput?.nativeElement.focus());
  }

  toggle(s: string) {
    const set = new Set(this.selectedSlots());
    set.has(s) ? set.delete(s) : set.add(s);
    this.selectedSlots.set(Array.from(set).sort());
  }
  toggleAllSlots() {
    if (this.allSelected()) {
      this.selectedSlots.set([]);
    } else {
      // Copy in case pendingSlots is a signal that may mutate externally
      this.selectedSlots.set([...this.allSlots()].sort());
    }
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

  // Reactive safeguard: if the prompt slot arrives AFTER dialog creation (race), select it.
  private promptSlotSync = effect(() => {
    const ps = this.ipc.lastPromptSlot();
    const pending = this.ipc.pendingSlots();
    if (!ps) return;
    const currentSel = this.selectedSlots();
    // Only adjust if prompt slot is pending and either not selected or selection is empty.
    if (pending.includes(ps) && (currentSel.length === 0 || !currentSel.includes(ps))) {
      this.selectedSlots.set([ps]);
    }
  });
}
