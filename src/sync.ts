import { getDb } from './db';
import { fetchActivities, StravaActivity } from './strava';

function getSyncState(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

function setSyncState(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)').run(key, value);
}

function upsertActivity(activity: StravaActivity): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO activities
      (id, name, sport_type, start_date, moving_time_sec, distance_m, avg_hr, max_hr, total_elevation_gain, synced_at)
    VALUES
      (@id, @name, @sport_type, @start_date, @moving_time_sec, @distance_m, @avg_hr, @max_hr, @total_elevation_gain, @synced_at)
  `).run({
    id: activity.id,
    name: activity.name,
    sport_type: activity.sport_type,
    start_date: activity.start_date,
    moving_time_sec: activity.moving_time,
    distance_m: activity.distance,
    avg_hr: activity.average_heartrate ?? null,
    max_hr: activity.max_heartrate ?? null,
    total_elevation_gain: activity.total_elevation_gain,
    synced_at: new Date().toISOString(),
  });
}

export async function sync(full: boolean): Promise<void> {
  const afterEpoch = full ? 0 : parseInt(getSyncState('last_epoch') ?? '0', 10);
  const label = full ? 'full sync' : `incremental sync (after ${new Date(afterEpoch * 1000).toISOString()})`;
  console.log(`Starting ${label}...`);

  const activities = await fetchActivities(afterEpoch);
  console.log(`Total activities fetched: ${activities.length}`);

  if (activities.length === 0) {
    console.log('Nothing new to sync.');
    return;
  }

  const upsert = getDb().transaction((items: StravaActivity[]) => {
    for (const a of items) upsertActivity(a);
  });
  upsert(activities);

  const latest = activities.reduce((max, a) => {
    const t = Math.floor(new Date(a.start_date).getTime() / 1000);
    return t > max ? t : max;
  }, afterEpoch);
  setSyncState('last_epoch', String(latest));

  console.log(`Synced ${activities.length} activities. last_epoch updated to ${latest}.`);
}
