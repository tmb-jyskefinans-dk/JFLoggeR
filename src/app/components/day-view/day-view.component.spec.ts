import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DayViewComponent } from './day-view.component';
import { IpcService } from '../../services/ipc.service';

describe('DayViewComponent description editing', () => {
  let fixture: ComponentFixture<DayViewComponent>;
  let originalWorkApi: typeof window.workApi | undefined;
  let saveEntries: jasmine.Spy;
  const day = '2026-05-19';
  const dayEntries = signal<any[]>([]);
  const dayExported = signal(new Map<string, boolean>());

  const ipcMock = {
    dayEntries,
    dayExported,
    days: signal<any[]>([]),
    settings: signal<any>(null),
    pendingSlots: signal<string[]>([]),
    flexBalance: signal({ enabled: false }),
    loadDay: jasmine.createSpy('loadDay').and.resolveTo(undefined),
    refreshDays: jasmine.createSpy('refreshDays'),
    getDays: jasmine.createSpy('getDays').and.resolveTo([]),
    loadFlexBalance: jasmine.createSpy('loadFlexBalance').and.resolveTo(undefined),
    loadRecent: jasmine.createSpy('loadRecent')
  } as unknown as IpcService;

  const el = () => fixture.nativeElement as HTMLElement;
  const input = () => el().querySelector('input[name="description"]') as HTMLInputElement | null;
  const render = () => { fixture.detectChanges(); flushMicrotasks(); fixture.detectChanges(); };

  beforeEach(async () => {
    dayEntries.set([
      { day, start: '08:00', end: '08:15', description: 'ABC-1 - Fix', category: 'Dev' },
      { day, start: '08:15', end: '08:30', description: 'ABC-1 - Fix', category: 'Dev' }
    ]);
    dayExported.set(new Map());
    originalWorkApi = (window as any).workApi;
    saveEntries = jasmine.createSpy('saveEntries').and.resolveTo(undefined);
    (window as any).workApi = { saveEntries };

    await TestBed.configureTestingModule({
      imports: [DayViewComponent],
      providers: [
        provideRouter([]),
        { provide: IpcService, useValue: ipcMock },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ ymd: day })), snapshot: { paramMap: convertToParamMap({ ymd: day }) } } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DayViewComponent);
  });

  afterEach(() => {
    fixture.destroy();
    (window as any).workApi = originalWorkApi;
  });

  it('double-click opens an editor that saves only that interval and returns focus to its edit button', fakeAsync(() => {
    render();
    const descriptions = el().querySelectorAll('li.day-block p[title]');
    descriptions[1].dispatchEvent(new MouseEvent('dblclick'));
    render();

    expect(input()?.value).toBe('ABC-1 - Fix');
    expect(document.activeElement).toBe(input());

    input()!.value = 'ABC-1 - Review';
    input()!.dispatchEvent(new Event('input'));
    input()!.form!.dispatchEvent(new Event('submit'));
    render();

    expect(saveEntries).toHaveBeenCalledOnceWith([
      { day, start: '08:15', end: '08:30', description: 'ABC-1 - Review', category: 'Dev' }
    ]);
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(el().querySelector('[data-desc-edit="08:15"]'));
  }));

  it('edit button opens the editor; Escape cancels and empty text is rejected', fakeAsync(() => {
    render();
    (el().querySelector('[data-desc-edit="08:00"]') as HTMLButtonElement).click();
    render();

    input()!.value = '  ';
    input()!.dispatchEvent(new Event('input'));
    input()!.form!.dispatchEvent(new Event('submit'));
    render();
    expect(saveEntries).not.toHaveBeenCalled();
    expect(input()?.getAttribute('aria-invalid')).toBe('true');
    expect(el().textContent).toContain('Beskrivelsen må ikke være tom.');

    input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    render();
    expect(input()).toBeNull();
    expect(saveEntries).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el().querySelector('[data-desc-edit="08:00"]'));
  }));

  it('does not allow editing on a locked day', fakeAsync(() => {
    dayExported.set(new Map([[day, true]]));
    render();
    expect(el().querySelector('[data-desc-edit]')).toBeNull();
    el().querySelector('li.day-block p')!.dispatchEvent(new MouseEvent('dblclick'));
    render();
    expect(input()).toBeNull();
  }));
});
