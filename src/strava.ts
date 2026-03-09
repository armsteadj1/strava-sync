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
}

function readConfig(): Config {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function writeConfig(config: Config): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function getAccessToken(): Promise<string> {
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
