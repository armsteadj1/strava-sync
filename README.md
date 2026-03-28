# strava-sync

Syncs Strava activities to a local SQLite database with full time-series data — power, HR, cadence, speed — plus private notes and rich activity metadata.

## Installation

```bash
npm install -g @armsteadj1/strava-sync
```

Or run from source:
```bash
git clone https://github.com/armsteadj1/strava-sync
cd strava-sync
npm install
```

## Setup

### 1. Create a Strava API App

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an app — set **Authorization Callback Domain** to `localhost`
3. Note your **Client ID** and **Client Secret**

### 2. Configure

```bash
cp config.example.json config.json
```

Fill in `client_id` and `client_secret`. Leave the token fields as-is — they'll be filled by the auth step.

### 3. Authorize

```bash
strava-sync auth
```

This prints an OAuth URL. Open it in your browser, authorize, then paste the redirect URL back:

```bash
strava-sync auth --code "http://localhost:8888/callback/strava?code=abc123..."
```

Tokens are saved to `config.json` and auto-refresh on each sync.

### 4. Initial Sync

```bash
# Pull all activities (detail + streams for rides/runs):
strava-sync sync --full

# Backfill streams/detail on existing activities (50 at a time, ~2 req/sec):
strava-sync enrich
```

## Commands

| Command | Description |
|---|---|
| `strava-sync sync` | Incremental sync — new activities only, auto-enriches them |
| `strava-sync sync --full` | Full re-download from epoch 0 |
| `strava-sync enrich` | Fetch detail + streams for up to 50 activities missing them |
| `strava-sync enrich --limit=N` | Same, custom limit |
| `strava-sync status` | Show DB stats (activity count, stream coverage, last sync) |
| `strava-sync auth` | Start OAuth flow |
| `strava-sync auth --code <url>` | Complete OAuth flow |

## Database

SQLite file: `fitness.db` (gitignored — never committed)

### Tables

**`activities`** — one row per activity

| Column | Description |
|---|---|
| `id` | Strava activity ID |
| `name` | Activity name |
| `sport_type` | Ride, VirtualRide, Run, WeightTraining, etc. |
| `start_date` | UTC ISO timestamp |
| `moving_time_sec` | Duration in seconds |
| `distance_m` | Distance in meters |
| `avg_hr` / `max_hr` | Heart rate |
| `avg_watts` / `max_watts` | Raw power averages |
| `weighted_avg_watts` | Normalized Power (NP) — best effort metric |
| `description` | Route/map name (e.g. "Figure 8 in Watopia") |
| `private_notes` | Your own post-activity notes |
| `has_streams` | 1 if time-series data is loaded |
| `total_elevation_gain` | Elevation in meters |

**`activity_streams`** — per-second time-series data for rides/runs

| Column | Description |
|---|---|
| `activity_id` | Foreign key → activities.id |
| `time_offset` | Seconds from activity start |
| `watts` | Power output |
| `heartrate` | Heart rate |
| `cadence` | Pedal cadence (rpm) |
| `velocity_ms` | Speed in m/s |
| `altitude_m` | Elevation in meters |

### Example Queries

```bash
# Recent activities with power data
sqlite3 fitness.db "
SELECT name, datetime(start_date,'localtime'), moving_time_sec/60 as min,
       weighted_avg_watts as np, avg_hr
FROM activities WHERE start_date >= datetime('now','-7 days')
ORDER BY start_date DESC;"

# Best 20-minute power from a specific ride
sqlite3 fitness.db "
SELECT MAX(avg_w) as best_20min_watts FROM (
  SELECT AVG(watts) OVER (ORDER BY time_offset ROWS BETWEEN 0 PRECEDING AND 1199 FOLLOWING) as avg_w
  FROM activity_streams WHERE activity_id = <ID> AND watts IS NOT NULL
);"

# Power zone distribution (FTP = 230w)
sqlite3 fitness.db "
SELECT
  SUM(CASE WHEN watts < 138 THEN 1 ELSE 0 END) as z1_sec,
  SUM(CASE WHEN watts >= 207 AND watts < 230 THEN 1 ELSE 0 END) as z4_sweet_spot_sec
FROM activity_streams WHERE activity_id = <ID>;"
```

## Auto-Sync (macOS)

Set up a LaunchAgent to sync every hour:

```bash
# ~/Library/LaunchAgents/com.strava-sync.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.strava-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/strava-sync</string>
    <string>sync</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/your/strava-sync/dir</string>
  <key>StartInterval</key><integer>3600</integer>
</dict>
</plist>
```

## Rate Limits

Strava allows 100 requests/15 minutes and 1,000/day. The enrich command paces at ~1 req/second (2 requests per activity — detail + streams), so 50 activities ≈ 100 requests ≈ 100 seconds. Safe for daily use.
