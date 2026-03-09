#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { sync } from './sync';
import { getDb } from './db';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const args = process.argv.slice(2);
const command = args[0] ?? 'sync';

async function cmdAuth(): Promise<void> {
  const codeArgIdx = args.indexOf('--code');

  if (codeArgIdx === -1) {
    // Print OAuth URL and instructions
    let clientId = 'CLIENT_ID';
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (cfg.client_id) clientId = cfg.client_id;
      } catch {
        // ignore
      }
    }

    const url = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=http://localhost:8888/callback/strava&approval_prompt=force&scope=activity:read_all,profile:read_all,read`;

    console.log('Strava OAuth Setup');
    console.log('==================');
    console.log('1. Open this URL in your browser:');
    console.log(`   ${url}`);
    console.log('');
    console.log('2. Click "Authorize" in Strava');
    console.log('3. The page will fail to load — that is expected');
    console.log('4. Copy the full URL from your browser address bar and run:');
    console.log('   strava-sync auth --code "http://localhost:8888/callback/strava?code=XXXXX..."');
    return;
  }

  const rawUrl = args[codeArgIdx + 1];
  if (!rawUrl) {
    console.error('Error: --code requires a URL argument');
    process.exit(1);
  }

  let code: string;
  try {
    const parsed = new URL(rawUrl);
    const c = parsed.searchParams.get('code');
    if (!c) throw new Error('No code param found');
    code = c;
  } catch {
    console.error('Error: could not parse code from URL:', rawUrl);
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Error: config.json not found at ${CONFIG_PATH}`);
    console.error('Create it from config.example.json with your client_id and client_secret.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  console.log('Exchanging code for tokens...');
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Token exchange failed: ${res.status} ${text}`);
    process.exit(1);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: { firstname: string; lastname: string };
  };

  const updated = {
    ...config,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));

  const athlete = data.athlete ? ` Welcome, ${data.athlete.firstname} ${data.athlete.lastname}!` : '';
  console.log(`Tokens saved to config.json.${athlete}`);
  console.log(`Access token expires at: ${new Date(data.expires_at * 1000).toISOString()}`);
}

async function cmdSync(): Promise<void> {
  const full = args.includes('--full');
  await sync(full);
}

function cmdStatus(): void {
  const db = getDb();

  const epochRow = db.prepare("SELECT value FROM sync_state WHERE key = 'last_epoch'").get() as { value: string } | undefined;
  const lastEpoch = epochRow ? parseInt(epochRow.value, 10) : null;

  const countRow = db.prepare('SELECT COUNT(*) as count FROM activities').get() as { count: number };

  const lastSyncRow = db.prepare('SELECT MAX(synced_at) as last_sync FROM activities').get() as { last_sync: string | null };

  console.log('Strava Sync Status');
  console.log('==================');
  console.log(`Activities in DB: ${countRow.count}`);
  if (lastEpoch) {
    console.log(`Last synced up to: ${new Date(lastEpoch * 1000).toISOString()}`);
  } else {
    console.log('Last synced up to: never');
  }
  if (lastSyncRow.last_sync) {
    console.log(`Last sync run at: ${lastSyncRow.last_sync}`);
  } else {
    console.log('Last sync run at: never');
  }
}

(async () => {
  try {
    switch (command) {
      case 'auth':
        await cmdAuth();
        break;
      case 'sync':
        await cmdSync();
        break;
      case 'status':
        cmdStatus();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: strava-sync <auth|sync|status> [--full] [--code <url>]');
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
