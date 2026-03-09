# strava-sync skill

Syncs Strava activity data to a local SQLite database. Run hourly via cron.

## CLI Commands

```bash
strava-sync auth                    # Print OAuth URL + setup instructions
strava-sync auth --code "<url>"     # Exchange redirect URL for tokens, save to config.json
strava-sync sync                    # Incremental sync (only new activities since last run)
strava-sync sync --full             # Full resync from the beginning
strava-sync status                  # Show last sync time + total activity count
```

## Database

Location: `~/projects/strava-sync/fitness.db`

### Tables

**activities**
- `id` — Strava activity ID (PK)
- `name` — Activity name
- `sport_type` — e.g. Run, Ride, VirtualRide, WeightTraining
- `start_date` — ISO timestamp
- `moving_time_sec` — Duration in seconds
- `distance_m` — Distance in meters
- `avg_hr` — Average heart rate (may be null)
- `max_hr` — Max heart rate (may be null)
- `total_elevation_gain` — Meters
- `synced_at` — When this record was synced

**sync_state**
- `key` — 'last_epoch'
- `value` — Unix timestamp of last synced activity

## Useful SQL Queries

```sql
-- Activities this week
SELECT sport_type, name, moving_time_sec/60 as min, avg_hr, start_date
FROM activities
WHERE start_date >= date('now', 'weekday 0', '-7 days')
ORDER BY start_date DESC;

-- Weekly lift count
SELECT count(*) as lifts
FROM activities
WHERE sport_type = 'WeightTraining'
  AND start_date >= date('now', 'weekday 0', '-7 days');

-- Cardio with high avg HR (zones 4/5 proxy: avg_hr > 150 for James)
SELECT name, start_date, moving_time_sec/60 as min, avg_hr
FROM activities
WHERE sport_type IN ('Run','Ride','VirtualRide','Swim')
  AND avg_hr > 150
  AND start_date >= date('now', '-30 days')
ORDER BY start_date DESC;

-- Activity count by type last 30 days
SELECT sport_type, count(*) as count
FROM activities
WHERE start_date >= date('now', '-30 days')
GROUP BY sport_type ORDER BY count DESC;

-- Recent 10 activities
SELECT sport_type, name, start_date, moving_time_sec/60 as min, avg_hr
FROM activities ORDER BY start_date DESC LIMIT 10;
```

## Query the DB directly

```bash
sqlite3 ~/projects/strava-sync/fitness.db "SELECT sport_type, name, start_date FROM activities ORDER BY start_date DESC LIMIT 5;"
```
