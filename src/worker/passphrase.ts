/**
 * The passphrase, and the hash of it the Worker holds as a secret.
 *
 * This tool now lives on a public `workers.dev` URL rather than only on
 * localhost, and it's a single-athlete tool with nothing gating it — every
 * request would otherwise be able to read this rider's ridden segments, KOM
 * standing and effective home location. A single shared passphrase, checked
 * via HTTP Basic Auth, is the smallest thing that closes that off. Ported
 * from cycling-reader's `src/shared/passphrase.ts`, which has the full
 * reasoning for PBKDF2 at this iteration count under the Workers CPU budget.
 *
 * The passphrase itself is never stored: the Worker holds only the encoded
 * output of `hashPassphrase`, as the `PASSPHRASE_HASH` secret.
 */

export const PBKDF2_ITERATIONS = 20_000;

const ALGORITHM = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const KEY_BITS = 256;

export async function hashPassphrase(
  passphrase: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(passphrase, salt, iterations);

  return [ALGORITHM, iterations, base64(salt), base64(derived)].join('$');
}

/** Whether a submitted passphrase is the one `encoded` was made from. */
export async function verifyPassphrase(passphrase: string, encoded: string): Promise<boolean> {
  const [algorithm, iterations, salt, expected] = encoded.split('$');

  if (algorithm !== ALGORITHM) return false;
  if (iterations === undefined || salt === undefined || expected === undefined) return false;

  const rounds = Number(iterations);
  if (!Number.isSafeInteger(rounds) || rounds < 1) return false;

  let expectedBytes: Uint8Array;
  try {
    expectedBytes = bytes(expected);
  } catch {
    return false;
  }

  return equal(await derive(passphrase, bytes(salt), rounds), expectedBytes);
}

async function derive(passphrase: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = new TextEncoder().encode(passphrase.normalize('NFC'));
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BITS,
  );

  return new Uint8Array(derived);
}

/** Compared in constant time, so a wrong passphrase reveals nothing by how quickly it's rejected. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] as number) ^ (b[i] as number);

  return difference === 0;
}

function base64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
