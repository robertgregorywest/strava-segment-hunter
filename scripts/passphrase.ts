import { createInterface } from 'node:readline/promises';
import { hashPassphrase } from '../src/worker/passphrase.ts';

/**
 * Turn a passphrase into the value of the `PASSPHRASE_HASH` Worker secret.
 *
 *   npx tsx --silent scripts/passphrase.ts | npx wrangler secret put PASSPHRASE_HASH
 *
 * Reads from a prompt rather than an argument so it never reaches shell
 * history and is never echoed; prints only the hash to stdout so it can be
 * piped straight into `wrangler secret put`. This repository is public.
 */

const input = createInterface({ input: process.stdin, output: process.stderr });

const asked = input.question('Passphrase: ');
mute();
const passphrase = await asked;
process.stderr.write('\n');
input.close();

if (passphrase.trim() === '') {
  process.stderr.write('Nothing entered.\n');
  process.exit(1);
}

process.stdout.write(`${await hashPassphrase(passphrase)}\n`);

function mute(): void {
  if (process.stdin.isTTY !== true) return;

  (input as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => {};
}
