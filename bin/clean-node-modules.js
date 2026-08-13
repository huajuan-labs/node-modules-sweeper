#!/usr/bin/env node
import { main } from '../dist/cli.js';
main(process.argv.slice(2)).catch(err => {
  process.stderr.write('Fatal: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
