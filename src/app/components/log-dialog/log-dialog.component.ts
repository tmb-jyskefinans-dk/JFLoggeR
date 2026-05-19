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
  jiraSuggestions = signal<JiraIssueSuggestion[]>([]);
  jiraLoading = signal(false);
  jiraWarning = signal('');
  jiraActiveIndex = signal<number>(-1);
  private jiraDebounceHandle: ReturnType<typeof setTimeout> | null = null;
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
  @ViewChild('submitBtn') submitBtn?: ElementRef<HTMLButtonElement>;
  @ViewChildren('jiraOption') jiraOptions?: QueryList<ElementRef<HTMLButtonElement>>;

  ngOnInit() {
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
      if (this.openedFromNotification()) this.submitBtn?.nativeElement.focus();
      else this.descInput?.nativeElement.focus();
    });
  }

  ngOnDestroy() {
    if (this.jiraDebounceHandle) {
      clearTimeout(this.jiraDebounceHandle);
      this.jiraDebounceHandle = null;
    }
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

  private clearJiraSuggestions() {
    this.jiraSuggestions.set([]);
    this.jiraActiveIndex.set(-1);
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

    const term = this.description().trim();
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

