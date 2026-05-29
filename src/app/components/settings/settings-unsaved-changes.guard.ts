import { CanDeactivateFn } from '@angular/router';
import { SettingsComponent } from './settings.component';

export const settingsUnsavedChangesGuard: CanDeactivateFn<SettingsComponent> = (component) => {
  return component.requestLeaveConfirmation();
};
