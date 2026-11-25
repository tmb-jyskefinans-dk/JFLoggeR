import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { LogDialogComponent } from './log-dialog.component';
import { IpcService } from '../../services/ipc.service';

describe('LogDialogComponent', () => {
  let fixture: ComponentFixture<LogDialogComponent>;
  let component: LogDialogComponent;
  let originalWorkApi: typeof window.workApi | undefined;

  const pendingSlots = signal<string[]>([]);
  const preselectedSlots = signal<string[] | null>(null);
  const lastPromptSlot = signal<string | null>(null);
  const recent = signal<any[]>([]);
  const settings = signal<any>({ slot_minutes: 15 });
  const bulkSelectAllFlag = signal(false);

  const ipcMock = {
    pendingSlots,
    preselectedSlots,
    lastPromptSlot,
    recent,
    settings,
    bulkSelectAllFlag,
    dayExported: signal(new Map<string, boolean>()),
    loadRecent: jasmine.createSpy('loadRecent'),
    submitPending: jasmine.createSpy('submitPending').and.resolveTo(undefined),
    loadDay: jasmine.createSpy('loadDay'),
    searchJiraIssues: jasmine.createSpy('searchJiraIssues').and.resolveTo({ ok: true, items: [] })
  } as unknown as IpcService;

  beforeEach(async () => {
    pendingSlots.set([]);
    preselectedSlots.set(null);
    lastPromptSlot.set(null);
    recent.set([]);
    settings.set({ slot_minutes: 15 });
    bulkSelectAllFlag.set(false);
    for (const spy of ['loadRecent', 'submitPending', 'loadDay', 'searchJiraIssues']) {
      ((ipcMock as any)[spy] as jasmine.Spy).calls.reset();
    }

    originalWorkApi = (window as any).workApi;
    (window as any).workApi = {
      getDayEntries: jasmine.createSpy('getDayEntries').and.resolveTo([])
    };

    await TestBed.configureTestingModule({
      imports: [LogDialogComponent],
      providers: [{ provide: IpcService, useValue: ipcMock }]
    }).compileComponents();

    fixture = TestBed.createComponent(LogDialogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    (window as any).workApi = originalWorkApi;
  });

  it('renders inline variant without modal backdrop', () => {
    fixture.componentRef.setInput('variant', 'inline');
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains('contents')).toBeTrue();
    expect(wrapper.classList.contains('fixed')).toBeFalse();
    expect(fixture.nativeElement.querySelector('form')?.getAttribute('aria-modal')).toBeNull();
  });

  it('focuses description input on manual open', fakeAsync(() => {
    pendingSlots.set(['2026-05-19T12:00']);
    fixture.componentRef.setInput('openedFromPrompt', false);

    fixture.detectChanges();
    flushMicrotasks();

    const descInput = fixture.nativeElement.querySelector('input[name="description"]') as HTMLInputElement;
    expect(descInput).toBeTruthy();
    expect(document.activeElement).toBe(descInput);
  }));

  it('defaults manual start to the current slot boundary', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(2026, 10, 17, 7, 5));
      fixture.componentRef.setInput('manualMode', true);
      fixture.detectChanges();

      expect(component.manualStart()).toBe('07:00');
      expect(component.manualEnd()).toBe('08:00');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('focuses submit button on interval prompt open', fakeAsync(() => {
    pendingSlots.set(['2026-05-19T12:00']);
    component.category.set('Projekt');
    component.description.set('Arbejde');
    fixture.componentRef.setInput('openedFromPrompt', true);

    fixture.detectChanges();
    flushMicrotasks();

    const submitButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitButton).toBeTruthy();
    expect(submitButton.disabled).toBeFalse();
    expect(document.activeElement).toBe(submitButton);
  }));

  it('ignores a submit right after the interval prompt focused submit', fakeAsync(() => {
    pendingSlots.set(['2026-05-19T12:00']);
    component.category.set('Projekt');
    component.description.set('Arbejde');
    fixture.componentRef.setInput('openedFromPrompt', true);
    fixture.detectChanges();
    flushMicrotasks();

    void component.submit();
    flushMicrotasks();
    expect((ipcMock as any).submitPending).not.toHaveBeenCalled();

    tick(700);
    void component.submit();
    flushMicrotasks();
    expect((ipcMock as any).submitPending).toHaveBeenCalled();
  }));

  it('keeps existing multi-selection when a new prompt slot arrives', () => {
    pendingSlots.set(['2026-05-19T12:00', '2026-05-19T12:15']);
    fixture.detectChanges();

    component.selectedSlots.set(['2026-05-19T12:00', '2026-05-19T12:15']);

    pendingSlots.set(['2026-05-19T12:00', '2026-05-19T12:15', '2026-05-19T12:30']);
    lastPromptSlot.set('2026-05-19T12:30');

    expect(component.selectedSlots()).toEqual(['2026-05-19T12:00', '2026-05-19T12:15']);
  });

  it('auto-selects prompt slot when there is no active selection', fakeAsync(() => {
    pendingSlots.set(['2026-05-19T12:30']);
    fixture.detectChanges();

    component.selectedSlots.set([]);
    lastPromptSlot.set('2026-05-19T12:30');
    fixture.detectChanges();
    flushMicrotasks();

    expect(component.selectedSlots()).toEqual(['2026-05-19T12:30']);
  }));

  it('keeps preselected missed slots selected and visible when the pending queue reloads without them', () => {
    // Main only queued 12:00; 12:15 (missed) and 12:30 (running) come from the day view.
    pendingSlots.set(['2026-05-19T12:00']);
    preselectedSlots.set(['2026-05-19T12:00', '2026-05-19T12:15', '2026-05-19T12:30']);
    fixture.detectChanges();

    // Minute tick / focus / queue:updated reloads the queue from main.
    pendingSlots.set(['2026-05-19T12:00']);
    fixture.detectChanges();
    pendingSlots.set([]);
    fixture.detectChanges();

    const all = ['2026-05-19T12:00', '2026-05-19T12:15', '2026-05-19T12:30'];
    expect(component.selectedSlots()).toEqual(all);
    expect(component.slotList().map(s => s.key)).toEqual(all);
    const chips = fixture.nativeElement.querySelectorAll('[role="listbox"] button') as NodeListOf<HTMLButtonElement>;
    expect(Array.from(chips).map(b => b.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);
  });

  it('keeps a deselected non-queued slot visible so it can be selected again', () => {
    pendingSlots.set(['2026-05-19T12:00']);
    preselectedSlots.set(['2026-05-19T12:15']);
    fixture.detectChanges();

    component.toggle('2026-05-19T12:15');
    pendingSlots.set(['2026-05-19T12:00']);
    expect(component.selectedSlots()).toEqual([]);
    expect(component.slotList().map(s => s.key)).toEqual(['2026-05-19T12:00', '2026-05-19T12:15']);

    component.toggleAllSlots();
    expect(component.selectedSlots()).toEqual(['2026-05-19T12:00', '2026-05-19T12:15']);
  });

  it('submits every selected slot even after the queue dropped them', async () => {
    pendingSlots.set(['2026-05-19T12:00', '2026-05-19T12:15']);
    preselectedSlots.set(['2026-05-19T12:00', '2026-05-19T12:15']);
    fixture.detectChanges();
    pendingSlots.set([]);
    component.category.set('Projekt');
    component.description.set('Arbejde');

    await component.submit();

    expect((ipcMock as any).submitPending).toHaveBeenCalledWith(['2026-05-19T12:00', '2026-05-19T12:15'], 'Arbejde', 'Projekt');
  });

  it('searches Jira for non-Andet categories', fakeAsync(() => {
    component.category.set('Projekt');
    component.onDescriptionInput('TEAM');
    tick(350);
    flushMicrotasks();
    expect((ipcMock as any).searchJiraIssues).toHaveBeenCalled();

    (ipcMock as any).searchJiraIssues.calls.reset();
    component.category.set('Andet');
    component.onDescriptionInput('TEAM');
    tick(350);
    flushMicrotasks();
    expect((ipcMock as any).searchJiraIssues).not.toHaveBeenCalled();
  }));

  it('inserts KEY - Summary and preserves selected category when Jira suggestion is selected', () => {
    component.category.set('Projekt');
    component.selectJiraSuggestion({
      key: 'TEAMJYFWEB-13081',
      summary: 'Supporter nye statusopdateringer fra Fibos',
      iconUrl: 'https://jira/icon.png'
    });

    expect(component.description()).toBe('TEAMJYFWEB-13081 - Supporter nye statusopdateringer fra Fibos');
    expect(component.category()).toBe('Projekt');
  });

  it('requires selected Jira issue for Udvikling Projekter categories', async () => {
    component.category.set('Udvikling (prioriterede jf. projektoversigten)');
    component.description.set('Arbejder med feature uden valgt issue');
    component.selectedSlots.set(['2026-05-19T12:00']);

    await component.submit();
    expect((ipcMock as any).submitPending).not.toHaveBeenCalled();

    component.selectJiraSuggestion({
      key: 'TEAMJYFWEB-13081',
      summary: 'Supporter nye statusopdateringer fra Fibos',
      iconUrl: 'https://jira/icon.png'
    });

    await component.submit();
    expect((ipcMock as any).submitPending).toHaveBeenCalled();
  });

  it('accepts adjacent-slot prefill with Jira key for Udvikling Projekter without manual re-selection', fakeAsync(() => {
    (window as any).workApi.getDayEntries = jasmine.createSpy('getDayEntries').and.resolveTo([
      {
        day: '2026-05-19',
        start: '11:45',
        category: 'Udvikling (prioriterede jf. projektoversigten)',
        description: 'TEAMJYFWEB-13081 - Supporter nye statusopdateringer fra Fibos'
      }
    ]);
    pendingSlots.set(['2026-05-19T12:00']);
    lastPromptSlot.set('2026-05-19T12:00');

    fixture.detectChanges();
    flushMicrotasks();

    expect(component.category()).toBe('Udvikling (prioriterede jf. projektoversigten)');
    expect(component.description()).toBe('TEAMJYFWEB-13081 - Supporter nye statusopdateringer fra Fibos');
    expect(component.hasValidSelectedJiraIssue()).toBeTrue();

    void component.submit();
    flushMicrotasks();
    expect((ipcMock as any).submitPending).toHaveBeenCalled();
  }));

  it('reopens Jira autocomplete on description focus when value already exists', fakeAsync(() => {
    component.category.set('Udvikling (prioriterede jf. projektoversigten)');
    component.description.set('TEAMJYFWEB-13081 - Supporter nye statusopdateringer fra Fibos');

    component.onDescriptionFocus();
    flushMicrotasks();

    expect((ipcMock as any).searchJiraIssues).toHaveBeenCalledWith('TEAMJYFWEB-13081 - Supporter nye statusopdateringer fra Fibos');
  }));

  it('returns correct role class with assignee precedence', () => {
    expect(component.jiraSuggestionRoleClass({
      key: 'TEAM-1',
      summary: 'A',
      iconUrl: '',
      isCurrentUserAssignee: true,
      isCurrentUserCoAssignee: true,
      isCurrentUserReporter: true
    })).toBe('jira-suggestion-role-assignee');

    expect(component.jiraSuggestionRoleClass({
      key: 'TEAM-2',
      summary: 'B',
      iconUrl: '',
      isCurrentUserAssignee: false,
      isCurrentUserCoAssignee: true,
      isCurrentUserReporter: true
    })).toBe('jira-suggestion-role-co-assignee');

    expect(component.jiraSuggestionRoleClass({
      key: 'TEAM-3',
      summary: 'C',
      iconUrl: '',
      isCurrentUserAssignee: false,
      isCurrentUserCoAssignee: false,
      isCurrentUserReporter: true
    })).toBe('jira-suggestion-role-reporter');
  });
});
