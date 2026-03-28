import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

interface Config {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  moving_time: number;
  distance: number;
  average_heartrate?: number;
  max_heartrate?: number;
  total_elevation_gain: number;
  description?: string;
  private_note?: string;
  average_watts?: number;
  max_watts?: number;
  weighted_average_watts?: number;
}

export interface StreamDataPoint {
  time_offset: number;
  watts?: number;
  heartrate?: number;
  cadence?: number;
  velocity_ms?: number;
  altitude_m?: number;
}

// Sport types that have meaningful power/HR streams
const STREAM_SPORT_TYPES = new Set([
  'Ride', 'VirtualRide', 'Run', 'VirtualRun', 'Walk', 'Hike',
  'Swim', 'Rowing', 'Kayaking', 'Elliptical',
]);

function readConfig(): Config {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function writeConfig(config: Config): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function getAccessToken(): Promise<string> {
  const config = readConfig();
  const now = Math.floor(Date.now() / 1000);

  if (config.expires_at > now + 300) {
    return config.access_token;
  }

  console.log('Refreshing access token...');
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  const updated: Config = {
    ...config,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
  writeConfig(updated);
  console.log('Token refreshed, expires_at:', new Date(data.expires_at * 1000).toISOString());
  return updated.access_token;
}

export async function fetchActivities(afterEpoch: number): Promise<StravaActivity[]> {
  const token = await getAccessToken();
  const all: StravaActivity[] = [];
  let page = 1;

  while (true) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterEpoch}&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Strava API error: ${res.status} ${text}`);
    }

    const batch = await res.json() as StravaActivity[];
    if (batch.length === 0) break;

    all.push(...batch);
    console.log(`  Fetched page ${page}: ${batch.length} activities`);
    page++;
  }

  return all;
}

/** Fetch detailed activity (includes description + private_note + power fields) */
export async function fetchActivityDetail(id: number): Promise<StravaActivity> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Activity detail fetch failed for ${id}: ${res.status} ${text}`);
  }

  return res.json() as Promise<StravaActivity>;
}

/** Fetch time-series streams for an activity */
export async function fetchActivityStreams(
  id: number,
  sportType: string
): Promise<StreamDataPoint[] | null> {
  if (!STREAM_SPORT_TYPES.has(sportType)) return null;

  const token = await getAccessToken();
  const keys = 'time,watts,heartrate,cadence,velocity_smooth,altitude';
  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${id}/streams?keys=${keys}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (res.status === 404) return null; // No streams available
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Streams fetch failed for ${id}: ${res.status} ${text}`);
  }

  const data = await res.json() as Record<string, { data: number[] }>;
  const timeArr: number[] = data['time']?.data ?? [];
  if (timeArr.length === 0) return null;

  const wattsArr = data['watts']?.data;
  const hrArr = data['heartrate']?.data;
  const cadArr = data['cadence']?.data;
  const velArr = data['velocity_smooth']?.data;
  const altArr = data['altitude']?.data;

  return timeArr.map((t, i) => ({
    time_offset: t,
    watts: wattsArr?.[i] ?? undefined,
    heartrate: hrArr?.[i] ?? undefined,
    cadence: cadArr?.[i] ?? undefined,
    velocity_ms: velArr?.[i] ?? undefined,
    altitude_m: altArr?.[i] ?? undefined,
  }));
}

/** Sleep helper for rate limiting */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
