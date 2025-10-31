import { Routes } from '@angular/router';
import { DayViewComponent } from './components/day-view/day-view.component';
import { SummaryViewComponent } from './components/summary-view/summary-view.component';
import { ManualLogComponent } from './components/manual-log/manual-log.component';
import { SettingsComponent } from './components/settings/settings.component';



export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'today' },
  { path: 'today', component: DayViewComponent },
  { path: 'day/:ymd', component: DayViewComponent },
  { path: 'summary/:ymd', component: SummaryViewComponent },
  { path: 'manual', component: ManualLogComponent },
  { path: 'settings', component: SettingsComponent }
];
