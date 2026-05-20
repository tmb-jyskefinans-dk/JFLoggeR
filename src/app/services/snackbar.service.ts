import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SnackbarService {
  message = signal<string | null>(null);
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  show(message: string, durationMs = 3000) {
    const trimmed = String(message ?? '').trim();
    if (!trimmed) return;
    this.message.set(trimmed);
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.message.set(null);
      this.hideTimeout = null;
    }, durationMs);
  }

  dismiss() {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = null;
    this.message.set(null);
  }
}
