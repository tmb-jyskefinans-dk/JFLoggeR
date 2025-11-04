import { toLocalDateYMD } from './time';
import type { Settings } from './db';

/**
 * Pure helper to evaluate the oldest stale pending slot.
 * Returns { key, ageMinutes } if a pending slot exceeds threshold minutes.
 */
export function computeStaleSlot(pendingKeys: string[], now: Date, settings: Settings, slotMinutes: number): { key: string; ageMinutes: number } | null {
  if (!pendingKeys.length) return null;
  const threshold = settings.stale_threshold_minutes || (slotMinutes * 2);
  if (!threshold) return null;
  // Sort keys lexicographically ensures chronological order given format YYYY-MM-DDTHH:MM
  const oldestKey = [...pendingKeys].sort()[0];
  const [dayPart, hm] = oldestKey.split('T');
  if (!dayPart || !hm) return null;
  const [h,m] = hm.split(':').map(Number);
  const [y,mo,d] = dayPart.split('-').map(Number);
  const slotDate = new Date(y,(mo||1)-1,d||1,h,m,0,0);
  // Safety: only consider today for stale prompt; cross-day stale handled as backlog.
  if (dayPart !== toLocalDateYMD(now)) return null;
  const ageMin = (now.getTime() - slotDate.getTime()) / 60000;
  if (ageMin > threshold) return { key: oldestKey, ageMinutes: ageMin };
  return null;
}
