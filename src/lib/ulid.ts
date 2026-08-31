import { createHash, randomBytes } from "node:crypto";

const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ULID_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

function encodeTime(ms: number): string {
  let t = ms;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ENC.charAt(Math.floor(t % 32)) + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(bytes: Buffer): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ENC.charAt((acc >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom(randomBytes(10));
}

/**
 * Deterministic ULID for a natural key: time part pinned to zero, 80 random
 * bits from the first 10 bytes of sha256(key). Collectors can retry
 * `put --id` with the same key without duplicating records.
 */
export function ulidFromKey(key: string): string {
  const digest = createHash("sha256").update(key, "utf8").digest();
  return "0000000000" + encodeRandom(digest.subarray(0, 10));
}
