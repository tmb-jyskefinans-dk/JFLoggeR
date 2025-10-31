export type Entry = {
  id?: number;
  day: string;          // 'YYYY-MM-DD'
  start: string;        // 'HH:MM'
  end: string;          // 'HH:MM'
  description: string;
  category: string;
  created_at?: string;
};

export type RecentPreset = { description: string; category: string; uses: number; last_used: string; };
