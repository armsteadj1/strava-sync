import { getDb } from './db';
import { fetchActivities, fetchActivityDetail, fetchActivityStreams, sleep, StravaActivity, StreamDataPoint } from './strava';

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
      (id, name, sport_type, start_date, moving_time_sec, distance_m,
       avg_hr, max_hr, total_elevation_gain,
       description, private_notes,
       avg_watts, max_watts, weighted_avg_watts,
       has_streams, synced_at)
    VALUES
      (@id, @name, @sport_type, @start_date, @moving_time_sec, @distance_m,
       @avg_hr, @max_hr, @total_elevation_gain,
       @description, @private_notes,
       @avg_watts, @max_watts, @weighted_avg_watts,
       @has_streams, @synced_at)
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
    description: activity.description ?? null,
    private_notes: activity.private_note ?? null,
    avg_watts: activity.average_watts ?? null,
    max_watts: activity.max_watts ?? null,
    weighted_avg_watts: activity.weighted_average_watts ?? null,
    has_streams: 0,
    synced_at: new Date().toISOString(),
  });
}

function preserveStreamsFlag(activityId: number, activity: StravaActivity): void {
  // When re-upserting from list (no streams data), preserve existing has_streams value
  const db = getDb();
  const existing = db.prepare('SELECT has_streams FROM activities WHERE id = ?').get(activityId) as { has_streams: number } | undefined;
  if (existing?.has_streams) {
    db.prepare('UPDATE activities SET has_streams = 1 WHERE id = ?').run(activityId);
  }
}

function upsertStreams(activityId: number, streams: StreamDataPoint[]): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO activity_streams
      (activity_id, time_offset, watts, heartrate, cadence, velocity_ms, altitude_m)
    VALUES
      (@activity_id, @time_offset, @watts, @heartrate, @cadence, @velocity_ms, @altitude_m)
  `);
  const insertAll = db.transaction((pts: StreamDataPoint[]) => {
    for (const pt of pts) {
      insert.run({
        activity_id: activityId,
        time_offset: pt.time_offset,
        watts: pt.watts ?? null,
        heartrate: pt.heartrate ?? null,
        cadence: pt.cadence ?? null,
        velocity_ms: pt.velocity_ms ?? null,
        altitude_m: pt.altitude_m ?? null,
      });
    }
  });
  insertAll(streams);
  db.prepare('UPDATE activities SET has_streams = 1 WHERE id = ?').run(activityId);
}

/** Enrich activities missing detail and/or streams */
export async function enrich(limit: number = 50): Promise<void> {
  const db = getDb();

  // Activities without detail yet (description IS NULL)
  const noDetail = db.prepare(
    `SELECT id, sport_type FROM activities WHERE description IS NULL ORDER BY start_date DESC LIMIT ?`
  ).all(limit) as { id: number; sport_type: string }[];

  // Activities with detail but missing streams (for stream-eligible sport types)
  const noStreams = db.prepare(`
    SELECT id, sport_type FROM activities
    WHERE description IS NOT NULL
      AND has_streams = 0
      AND sport_type IN ('Ride','VirtualRide','Run','VirtualRun','Walk','Hike','Rowing','Kayaking')
    ORDER BY start_date DESC LIMIT ?
  `).all(limit) as { id: number; sport_type: string }[];

  const toEnrich = noDetail;
  const streamsOnly = noStreams.filter(a => !toEnrich.find(b => b.id === a.id));

  const totalWork = toEnrich.length + streamsOnly.length;
  if (totalWork === 0) {
    console.log('All activities already enriched.');
    return;
  }

  console.log(`Enriching: ${toEnrich.length} need detail+streams, ${streamsOnly.length} need streams only (capped at ${limit} each)`);

  let enriched = 0;
  let streamsFetched = 0;

  for (const { id, sport_type: knownType } of toEnrich) {
    try {
      const detail = await fetchActivityDetail(id);
      upsertActivity(detail);
      await sleep(1100);

      const streams = await fetchActivityStreams(id, detail.sport_type);
      if (streams && streams.length > 0) {
        upsertStreams(id, streams);
        streamsFetched++;
        console.log(`  ✓ [${detail.sport_type}] ${detail.name}: detail + ${streams.length} pts`);
      } else {
        console.log(`  ✓ [${detail.sport_type}] ${detail.name}: detail only`);
      }
      await sleep(1100);
      enriched++;
    } catch (err) {
      console.warn(`  ✗ ${id}: ${(err as Error).message}`);
    }
  }

  for (const { id, sport_type } of streamsOnly) {
    try {
      const streams = await fetchActivityStreams(id, sport_type);
      if (streams && streams.length > 0) {
        upsertStreams(id, streams);
        streamsFetched++;
        console.log(`  ✓ [${sport_type}] ${id}: +${streams.length} stream pts`);
      }
      await sleep(1100);
    } catch (err) {
      console.warn(`  ✗ streams ${id}: ${(err as Error).message}`);
    }
  }

  console.log(`Enrichment complete: ${enriched} detailed, ${streamsFetched} with streams.`);
}

export async function sync(full: boolean): Promise<void> {
  const afterEpoch = full ? 0 : parseInt(getSyncState('last_epoch') ?? '0', 10);
  const label = full ? 'full sync' : `incremental sync (after ${new Date(afterEpoch * 1000).toISOString()})`;
  console.log(`Starting ${label}...`);

  const activities = await fetchActivities(afterEpoch);
  console.log(`Total activities fetched: ${activities.length}`);

  if (activities.length > 0) {
    const db = getDb();
    const upsert = db.transaction((items: StravaActivity[]) => {
      for (const a of items) upsertActivity(a);
    });
    upsert(activities);

    const latest = activities.reduce((max, a) => {
      const t = Math.floor(new Date(a.start_date).getTime() / 1000);
      return t > max ? t : max;
    }, afterEpoch);
    setSyncState('last_epoch', String(latest));
    console.log(`Synced ${activities.length} activities. last_epoch updated.`);

    // Enrich new activities immediately (no cap needed — usually just a few)
    await enrich(activities.length + 5);
  } else {
    console.log('Nothing new to sync.');
  }
}
