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
  const settings = signal<any>({ slot_minutes: 15, minimize_after_notification_submit: false });
  const bulkSelectAllFlag = signal(false);

  const ipcMock = {
    pendingSlots,
    preselectedSlots,
    lastPromptSlot,
    recent,
    settings,
    bulkSelectAllFlag,
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
    settings.set({ slot_minutes: 15, minimize_after_notification_submit: false });
    bulkSelectAllFlag.set(false);

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

  it('focuses description input on manual open', fakeAsync(() => {
    pendingSlots.set(['2026-05-19T12:00']);
    fixture.componentRef.setInput('openedFromNotification', false);

    fixture.detectChanges();
    flushMicrotasks();

    const descInput = fixture.nativeElement.querySelector('input[name="description"]') as HTMLInputElement;
    expect(descInput).toBeTruthy();
    expect(document.activeElement).toBe(descInput);
  }));

  it('focuses submit button on notification open', fakeAsync(() => {
    pendingSlots.set(['2026-05-19T12:00']);
    component.category.set('Projekt');
    component.description.set('Arbejde');
    fixture.componentRef.setInput('openedFromNotification', true);

    fixture.detectChanges();
    flushMicrotasks();

    const submitButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitButton).toBeTruthy();
    expect(submitButton.disabled).toBeFalse();
    expect(document.activeElement).toBe(submitButton);
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

  it('searches Jira only for Udvikling Projekter categories', fakeAsync(() => {
    component.category.set('Projekt');
    component.onDescriptionInput('TEAM');
    tick(350);
    expect((ipcMock as any).searchJiraIssues).not.toHaveBeenCalled();

    component.category.set('Udvikling (prioriterede jf. projektoversigten)');
    component.onDescriptionInput('TEAM');
    tick(350);
    flushMicrotasks();
    expect((ipcMock as any).searchJiraIssues).toHaveBeenCalled();
  }));

  it('inserts KEY - Summary when Jira suggestion is selected', () => {
    component.selectJiraSuggestion({
      key: 'TEAMJYFWEB-13081',
      summary: 'Supporter nye statusopdateringer fra Fibos',
      iconUrl: 'https://jira/icon.png'
    });

    expect(component.description()).toBe('TEAMJYFWEB-13081 - Supporter nye statusopdateringer fra Fibos');
  });

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
