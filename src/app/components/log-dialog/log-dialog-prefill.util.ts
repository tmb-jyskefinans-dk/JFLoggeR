export type SlotEntry = {
  day: string;
  start: string;
  description: string;
  category: string;
};

export function getPreviousSlotKey(slotKey: string, slotMinutes: number): string | null {
  const match = slotKey.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, day, hourText, minuteText] = match;
  const totalMinutes = Number(hourText) * 60 + Number(minuteText);
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(slotMinutes) || slotMinutes <= 0 || totalMinutes < slotMinutes) {
    return null;
  }

  const previousMinutes = totalMinutes - slotMinutes;
  const previousHour = Math.floor(previousMinutes / 60);
  const previousMinute = previousMinutes % 60;
  return `${day}T${String(previousHour).padStart(2, '0')}:${String(previousMinute).padStart(2, '0')}`;
}

export function findAdjacentPreviousEntry(
  slotKey: string,
  entries: SlotEntry[],
  slotMinutes: number
): SlotEntry | null {
  const previousSlotKey = getPreviousSlotKey(slotKey, slotMinutes);
  if (!previousSlotKey) return null;

  return entries.find((entry) => `${entry.day}T${entry.start}` === previousSlotKey) ?? null;
}