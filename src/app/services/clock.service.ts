import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ClockService {
  today = signal(this.toYMD(new Date()));
  constructor() {
    setInterval(() => this.today.set(this.toYMD(new Date())), 60_000);
  }
  toYMD(d: Date) {
    const y = d.getFullYear();
    const m = `${d.getMonth()+1}`.padStart(2,'0');
    const dd = `${d.getDate()}`.padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
}
