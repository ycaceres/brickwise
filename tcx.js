/**
 * Builds an indoor running TCX from the session samples.
 * samples: [{ t: epoch ms, distance: m, speed: km/h, hr: bpm|null }]
 */
export function buildTcx(samples, { name = 'Treadwise run' } = {}) {
  if (!samples.length) throw new Error('No samples to export');

  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const start = samples[0].t;
  const last = samples[samples.length - 1];
  const totalSec = Math.round((last.t - start) / 1000);
  const hrs = samples.map((s) => s.hr).filter((h) => h > 0);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, h) => a + h, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const esc = (s) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

  const points = samples
    .map((s) => {
      const hr = s.hr > 0 ? `<HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>` : '';
      return (
        `<Trackpoint><Time>${iso(s.t)}</Time><DistanceMeters>${s.distance.toFixed(1)}</DistanceMeters>${hr}` +
        `<Extensions><ns3:TPX><ns3:Speed>${(s.speed / 3.6).toFixed(3)}</ns3:Speed></ns3:TPX></Extensions></Trackpoint>`
      );
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Running">
<Id>${iso(start)}</Id>
<Lap StartTime="${iso(start)}">
<TotalTimeSeconds>${totalSec}</TotalTimeSeconds>
<DistanceMeters>${last.distance.toFixed(1)}</DistanceMeters>
<Calories>0</Calories>
${avgHr ? `<AverageHeartRateBpm><Value>${avgHr}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${maxHr}</Value></MaximumHeartRateBpm>` : ''}
<Intensity>Active</Intensity>
<TriggerMethod>Manual</TriggerMethod>
<Track>
${points}
</Track>
</Lap>
<Notes>${esc(name)}</Notes>
</Activity></Activities>
</TrainingCenterDatabase>
`;
}
