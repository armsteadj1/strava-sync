import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'fitness.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY,
      name TEXT,
      sport_type TEXT,
      start_date TEXT,
      moving_time_sec INTEGER,
      distance_m REAL,
      avg_hr REAL,
      max_hr REAL,
      total_elevation_gain REAL,
      description TEXT,
      private_notes TEXT,
      avg_watts REAL,
      max_watts REAL,
      weighted_avg_watts REAL,
      has_streams INTEGER DEFAULT 0,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_streams (
      activity_id INTEGER NOT NULL,
      time_offset INTEGER NOT NULL,
      watts INTEGER,
      heartrate INTEGER,
      cadence INTEGER,
      velocity_ms REAL,
      altitude_m REAL,
      PRIMARY KEY (activity_id, time_offset)
    );

    CREATE INDEX IF NOT EXISTS idx_streams_activity ON activity_streams(activity_id);

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migrate: add new columns if they don't exist yet
  const cols = (db.prepare("PRAGMA table_info(activities)").all() as { name: string }[]).map(r => r.name);
  const newCols: [string, string][] = [
    ['description', 'TEXT'],
    ['private_notes', 'TEXT'],
    ['avg_watts', 'REAL'],
    ['max_watts', 'REAL'],
    ['weighted_avg_watts', 'REAL'],
    ['has_streams', 'INTEGER DEFAULT 0'],
  ];
  for (const [col, type] of newCols) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE activities ADD COLUMN ${col} ${type}`);
      console.log(`  Migrated: added column activities.${col}`);
    }
  }
}
