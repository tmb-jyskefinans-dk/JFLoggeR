import { Component, OnInit, AfterViewInit, OnDestroy, inject, signal, ChangeDetectionStrategy, output, ViewChild, ViewChildren, QueryList, ElementRef, computed, effect, input } from '@angular/core';
import { CATEGORY_GROUPS, CategoryGroup } from '../../models/categories';
import { IpcService, JiraIssueSuggestion } from '../../services/ipc.service';
import { FormsModule } from '@angular/forms';
import { preserveCategoryDescriptions } from '../shared/category-description.util';
import { findAdjacentPreviousEntry } from './log-dialog-prefill.util';

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
export class LogDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  closed = output<void>();
  openedFromNotification = input(false);
  manualMode = input(false);
  manualInitialDate = input<string>('');

  ipc = inject(IpcService);

  // Manual mode fields
  manualDate = signal(new Date().toISOString().slice(0, 10));
  manualStart = signal('08:00');
  manualEnd = signal('09:00');
  manualError = signal('');

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
  selectedDays = computed(() => {
    if (this.manualMode()) {
      const day = this.manualDate();
      return day ? [day] : [];
    }
    return Array.from(new Set(this.selectedSlots().map(slot => slot.split('T')[0]).filter(Boolean)));
  });
  lockedDay = computed(() => this.selectedDays().find(day => !!this.ipc.dayExported().get(day)) ?? '');
  dayLocked = computed(() => !!this.lockedDay());
  dayLockMessage = computed(() => {
    const day = this.lockedDay();
    if (!day) return '';
    return this.manualMode()
      ? `Denne dag (${day}) er allerede afstemt. Skift dato for at fortsætte med en ulåst dag.`
      : `Denne dag (${day}) er allerede afstemt. Nye registreringer og ændringer er låst.`;
  });
  jiraSuggestions = signal<JiraIssueSuggestion[]>([]);
  jiraLoading = signal(false);
  jiraWarning = signal('');
  jiraActiveIndex = signal<number>(-1);
  private jiraDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  private submitFocusRetryHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly jiraMinTermLength = 2;
  private readonly jiraLookupDebounceMs = 300;
  allSelected = computed(() => {
    const all = this.allSlots();
    const selected = this.selectedSlots();
    return all.length > 0 && selected.length === all.length && all.every(s => selected.includes(s));
  });
  description = signal('');
  category = signal('');
  andetDescription = signal('');
  // Suggestion feature removed; keeping component lean.
  categoryGroups: CategoryGroup[] = CATEGORY_GROUPS;
  private jiraAutocompleteCategories = new Set(
    CATEGORY_GROUPS.find((g) => g.label === 'Udvikling Projekter')?.items ?? []
  );
  jiraAutocompleteEnabled = computed(() => this.jiraAutocompleteCategories.has(this.category().trim()));
  unmatchedCategory(): boolean {
    const c = this.category().trim();
    if (!c) return false;
    return !this.categoryGroups.some(g => g.items.includes(c));
  }

  @ViewChild('descInput') descInput?: ElementRef<HTMLInputElement>;
  @ViewChild('manualDateInput') manualDateInput?: ElementRef<HTMLInputElement>;
  @ViewChild('submitBtn') submitBtn?: ElementRef<HTMLButtonElement>;
  @ViewChildren('jiraOption') jiraOptions?: QueryList<ElementRef<HTMLButtonElement>>;

  ngOnInit() {
    if (this.manualMode()) {
      const d = this.manualInitialDate();
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) this.manualDate.set(d);
      this.ipc.loadRecent();
      return;
    }
    const list = this.ipc.pendingSlots();
    const preselected = this.ipc.preselectedSlots();
    const promptSlot = this.ipc.lastPromptSlot ? this.ipc.lastPromptSlot() : null;
    if (preselected?.length) {
      const selected = preselected.filter(s => list.includes(s));
      if (selected.length) this.selectedSlots.set([...selected].sort());
      else if (list.length) this.selectedSlots.set(list.slice(0, 1));
      this.ipc.preselectedSlots.set(null);
    } else if (this.ipc.bulkSelectAllFlag && this.ipc.bulkSelectAllFlag()) {
      // Bulk selection mode triggered from tray
      this.selectedSlots.set([...list].sort());
      // Reset flag so future opens revert to normal selection heuristics
      this.ipc.bulkSelectAllFlag.set(false);
    } else {
      if (promptSlot && list.includes(promptSlot)) {
        // Prefer the slot that triggered the dialog
        this.selectedSlots.set([promptSlot]);
        this.prefillFromAdjacentPreviousSlot(promptSlot);
      } else if (list.length) {
        // Fallback: first pending slot
        this.selectedSlots.set(list.slice(0, 1));
      }
    }
    this.ipc.loadRecent();
  }

  ngAfterViewInit() {
    queueMicrotask(() => {
      if (this.manualMode() && this.dayLocked()) {
        this.manualDateInput?.nativeElement.focus();
        return;
      }
      if (this.dayLocked()) return;
      if (this.openedFromNotification()) this.focusSubmitWhenReady();
      else this.descInput?.nativeElement.focus();
    });
  }

  ngOnDestroy() {
    if (this.jiraDebounceHandle) {
      clearTimeout(this.jiraDebounceHandle);
      this.jiraDebounceHandle = null;
    }
    if (this.submitFocusRetryHandle) {
      clearTimeout(this.submitFocusRetryHandle);
      this.submitFocusRetryHandle = null;
    }
  }

  private focusSubmitWhenReady(attempt = 0) {
    const btn = this.submitBtn?.nativeElement;
    if (btn && !btn.disabled) {
      btn.focus();
      return;
    }
    if (attempt >= 12) {
      // Fallback after ~600ms if submit never becomes enabled.
      this.descInput?.nativeElement.focus();
      return;
    }
    this.submitFocusRetryHandle = setTimeout(() => this.focusSubmitWhenReady(attempt + 1), 50);
  }

  toggle(s: string) {
    if (this.dayLocked()) return;
    const set = new Set(this.selectedSlots());
    set.has(s) ? set.delete(s) : set.add(s);
    this.selectedSlots.set(Array.from(set).sort());
  }
  toggleAllSlots() {
    if (this.dayLocked()) return;
    if (this.allSelected()) {
      this.selectedSlots.set([]);
    } else {
      // Copy in case pendingSlots is a signal that may mutate externally
      this.selectedSlots.set([...this.allSlots()].sort());
    }
  }
  remove(i: number) {
    if (this.dayLocked()) return;
    const next = [...this.selectedSlots()];
    next.splice(i, 1);
    this.selectedSlots.set(next);
  }
  applyPreset(v: string) {
    if (!v) return;
    const [desc, cat] = v.split('||');
    // If preset category is 'Andet', route description into andetDescription field
    if (cat === 'Andet') {
      this.category.set('Andet');
      if (desc) {
        this.andetDescription.set(desc);
        this.description.set(''); // clear primary description to avoid stale content
      }
    } else {
      if (desc) this.description.set(desc);
      if (cat) this.category.set(cat);
      // Clear special field when leaving 'Andet'
      if (this.category() !== 'Andet') this.andetDescription.set('');
    }
    this.refreshJiraAutocomplete(true);
  }
  async submit() {
    if (!this.manualMode() && this.dayLocked()) return;
    if (this.manualMode()) {
      await this.submitManual();
      return;
    }
    const slots = this.selectedSlots();
    const category = this.category().trim();
    const baseDescription = this.description().trim();
    const otherDescription = this.andetDescription().trim();
    let finalDescription = category === 'Andet' ? otherDescription : baseDescription;
    if (!slots.length || !category || !finalDescription) return;
    const minimizeAfterSubmit = this.openedFromNotification() && !!this.ipc.settings()?.minimize_after_notification_submit;
    await this.ipc.submitPending(slots, finalDescription, category, { minimizeWindowAfterSubmit: minimizeAfterSubmit });
    // Derive affected day from first slot and trigger reload of day & summary signals
    if (slots.length) {
      const day = slots[0].split('T')[0];
      this.ipc.loadDay(day);
    }
    this.description.set('');
    this.category.set('');
    this.andetDescription.set('');
    this.selectedSlots.set([]);
    this.closed.emit();
  }

  private async submitManual() {
    this.manualError.set('');
    const date = this.manualDate();
    const start = this.manualStart();
    const end = this.manualEnd();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { this.manualError.set('Ugyldig dato'); return; }
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) { this.manualError.set('Ugyldig tid'); return; }
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) { this.manualError.set('Sluttidspunkt skal være efter starttidspunkt'); return; }
    const category = this.category().trim();
    const baseDescription = this.description().trim();
    const otherDescription = this.andetDescription().trim();
    const finalDescription = category === 'Andet' ? otherDescription : baseDescription;
    if (!category || !finalDescription) { this.manualError.set('Beskrivelse og kategori er påkrævet'); return; }
    const slotMinutes = this.ipc.settings()?.slot_minutes ?? 15;
    const slots: string[] = [];
    for (let m = Math.floor(startMin / slotMinutes) * slotMinutes; m < endMin; m += slotMinutes) {
      const h = Math.floor(m / 60), mm = m % 60;
      slots.push(`${date}T${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    }
    const dayEntries = await window.workApi.getDayEntries(date);
    const toMin = (hm: string): number => {
      const [h, m] = String(hm ?? '').split(':').map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? (h * 60 + m) : NaN;
    };
    const isCovered = (slotKey: string): boolean => {
      const slotMin = toMin(slotKey.slice(11, 16));
      if (!Number.isFinite(slotMin)) return false;
      return dayEntries.some((e: any) => {
        const es = toMin(e?.start);
        const ee = toMin(e?.end);
        return Number.isFinite(es) && Number.isFinite(ee) && ee > es && slotMin >= es && slotMin < ee;
      });
    };
    const novel = slots.filter(k => !isCovered(k));
    if (!novel.length) { this.manualError.set('Ingen nye intervaller at gemme.'); return; }
    await this.ipc.submitPending(novel, finalDescription, category);
    this.ipc.loadDay(date);
    this.description.set('');
    this.category.set('');
    this.andetDescription.set('');
    this.closed.emit();
  }

  onCategoryChange(nextCategory: string) {
    const next = preserveCategoryDescriptions(nextCategory, this.description(), this.andetDescription());
    this.description.set(next.description);
    this.andetDescription.set(next.andetDescription);
    this.refreshJiraAutocomplete(true);
  }

  onDescriptionInput(nextValue: string) {
    this.description.set(nextValue);
    this.refreshJiraAutocomplete();
  }

  onDescriptionFocus() {
    this.refreshJiraAutocomplete(true);
  }

  onDescriptionKeyDown(event: KeyboardEvent) {
    const suggestions = this.jiraSuggestions();
    if (!suggestions.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.jiraActiveIndex.set(Math.min(this.jiraActiveIndex() + 1, suggestions.length - 1));
      this.scheduleScrollActiveJiraSuggestionIntoView();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.jiraActiveIndex.set(Math.max(this.jiraActiveIndex() - 1, 0));
      this.scheduleScrollActiveJiraSuggestionIntoView();
      return;
    }
    if (event.key === 'Enter' && this.jiraActiveIndex() >= 0) {
      event.preventDefault();
      this.selectJiraSuggestion(suggestions[this.jiraActiveIndex()]);
      return;
    }
    if (event.key === 'Escape') {
      this.clearJiraSuggestions();
    }
  }

  onDescriptionBlur() {
    // Let click handler on suggestion run before closing list.
    setTimeout(() => this.clearJiraSuggestions(), 120);
  }

  selectJiraSuggestion(item: JiraIssueSuggestion) {
    if (!item) return;
    this.description.set(`${item.key} - ${item.summary}`);
    this.clearJiraSuggestions();
  }

  jiraSuggestionRoleClass(item: JiraIssueSuggestion): string {
    if (item.isCurrentUserAssignee) return 'jira-suggestion-role-assignee';
    if (item.isCurrentUserCoAssignee) return 'jira-suggestion-role-co-assignee';
    if (item.isCurrentUserReporter) return 'jira-suggestion-role-reporter';
    return '';
  }

  private clearJiraSuggestions() {
    this.jiraSuggestions.set([]);
    this.jiraActiveIndex.set(-1);
  }

  /** If description already holds a resolved 'KEY-123 - Summary' value, extract just the key
   * so the autocomplete search uses a clean Jira key instead of the full display string. */
  private effectiveJiraSearchTerm(): string {
    const desc = this.description().trim();
    const match = desc.match(/^([A-Z]+-\d+)\s*-\s*.+/);
    return match ? match[1] : desc;
  }

  private refreshJiraAutocomplete(immediate = false) {
    if (this.jiraDebounceHandle) {
      clearTimeout(this.jiraDebounceHandle);
      this.jiraDebounceHandle = null;
    }

    if (!this.jiraAutocompleteEnabled()) {
      this.jiraWarning.set('');
      this.jiraLoading.set(false);
      this.clearJiraSuggestions();
      return;
    }

    const term = this.effectiveJiraSearchTerm();
    if (term.length < this.jiraMinTermLength) {
      this.jiraWarning.set('');
      this.jiraLoading.set(false);
      this.clearJiraSuggestions();
      return;
    }

    const runLookup = () => {
      this.jiraLoading.set(true);
      this.jiraWarning.set('');
      this.ipc.searchJiraIssues(term).then((resp) => {
        if (!resp.ok) {
          this.jiraWarning.set(resp.error || 'Jira forslag kunne ikke hentes.');
          this.clearJiraSuggestions();
          return;
        }
        this.jiraSuggestions.set(resp.items);
        this.jiraActiveIndex.set(resp.items.length ? 0 : -1);
        this.scheduleScrollActiveJiraSuggestionIntoView();
      }).catch(() => {
        this.jiraWarning.set('Jira forslag kunne ikke hentes.');
        this.clearJiraSuggestions();
      }).finally(() => {
        this.jiraLoading.set(false);
      });
    };

    if (immediate) runLookup();
    else this.jiraDebounceHandle = setTimeout(runLookup, this.jiraLookupDebounceMs);
  }

  private scheduleScrollActiveJiraSuggestionIntoView() {
    queueMicrotask(() => {
      const activeIndex = this.jiraActiveIndex();
      const option = this.jiraOptions?.get(activeIndex)?.nativeElement;
      option?.scrollIntoView({ block: 'nearest' });
    });
  }

  private prefillFromAdjacentPreviousSlot(slotKey: string) {
    const [day] = slotKey.split('T');
    const slotMinutes = this.ipc.settings()?.slot_minutes ?? 15;

    void window.workApi.getDayEntries(day).then((entries: Array<{ day: string; start: string; description: string; category: string }>) => {
      if (this.description().trim() || this.category().trim() || this.andetDescription().trim()) return;

      const previousEntry = findAdjacentPreviousEntry(slotKey, entries, slotMinutes);
      if (!previousEntry) return;

      this.category.set(previousEntry.category);
      if (previousEntry.category === 'Andet') {
        this.description.set('');
        this.andetDescription.set(previousEntry.description);
      } else {
        this.description.set(previousEntry.description);
        this.andetDescription.set('');
      }
    }).catch(() => {
      // Leave the dialog blank if the previous slot cannot be resolved.
    });
  }

  // Removed suggestion-related methods (refreshSuggestion, applySuggestion, applyWeakMatch).

  // Reactive safeguard: if the prompt slot arrives AFTER dialog creation (race), select it.
  private promptSlotSync = effect(() => {
    const ps = this.ipc.lastPromptSlot();
    const pending = this.ipc.pendingSlots();
    if (!ps) return;
    const currentSel = this.selectedSlots();
    // Preserve user multi-selection while dialog is open. Only auto-apply prompt slot
    // when there is no active selection (initial open/race recovery).
    if (pending.includes(ps) && currentSel.length === 0) {
      this.selectedSlots.set([ps]);
      this.prefillFromAdjacentPreviousSlot(ps);
    }
  });

  // React to description changes for suggestions (simple polling via effect over primitive fields)
  // Suggestion effect removed.
}

