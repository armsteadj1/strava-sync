# strava-sync

Syncs Strava activities to a local SQLite database (`fitness.db`).

## Setup

1. Copy `config.example.json` to `config.json` and fill in your Strava API credentials.
2. Install dependencies:
   ```
   npm install
   ```

## Usage

Incremental sync (only new activities since last run):
```
npm run sync
```

Full resync (all activities):
```
npm run sync -- --full
```

## Database

SQLite file: `fitness.db`

Tables:
- `activities` — id, name, sport_type, start_date, moving_time_sec, distance_m, avg_hr, max_hr, total_elevation_gain, synced_at
- `sync_state` — key/value store tracking `last_epoch`
