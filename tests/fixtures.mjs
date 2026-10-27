// Real data shared by the tests
import fs from 'node:fs';

// Real workout_doc returned by /events?resolve=true (Easy Run 9+1, Jan 29 2026)
export const easyRun = {
  steps: [
    { duration: 180, warmup: true, pace: { value: 1, units: 'pace_zone' }, _pace: { start: 1.6756739616394043, end: 2.094592332839966 } },
    {
      text: '2x', duration: 1200, reps: 2, steps: [
        { duration: 540, pace: { value: 2, units: 'pace_zone' }, _pace: { start: 2.094592332839966, end: 2.370267868041992 } },
        { duration: 60, pace: { value: 1, units: 'pace_zone' }, _pace: { start: 1.6756739616394043, end: 2.094592332839966 } },
      ],
    },
    { duration: 120, warmup: true, pace: { value: 1, units: 'pace_zone' }, _pace: { start: 1.6756739616394043, end: 2.094592332839966 } },
  ],
};

// The athlete's real running sport-settings (Oct 25 2026)
export const runSettings = {
  lthr: 168, max_hr: 185,
  hr_zones: [134, 150, 158, 168, 171, 178, 185],
  threshold_pace: 2.7027,
  pace_zones: [77.5, 87.7, 94.3, 100.0, 103.4, 111.5, 999.0],
};

// The workout library, as the page builds it
import { buildLibrary } from '../src/workouts/library.js';
export const LIBRARY = buildLibrary(JSON.parse(fs.readFileSync(new URL('../data/library.json', import.meta.url), 'utf8')));
