import { sync } from './sync';

const full = process.argv.includes('--full');

sync(full).catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
