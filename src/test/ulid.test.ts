import assert from "node:assert/strict";
import { test } from "node:test";
import { isUlid, ulid, ulidFromKey, ULID_PATTERN } from "../lib/ulid.js";

test("ulid() matches the ULID pattern and is unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = ulid();
    assert.ok(ULID_PATTERN.test(id), id);
    assert.ok(isUlid(id));
    seen.add(id);
  }
  assert.equal(seen.size, 500);
});

test("ulid() encodes the timestamp in the first 10 chars", () => {
  const at = 1780000000000; // a fixed ms timestamp
  const id = ulid(at);
  // decode the time part back (Crockford base32, 5 bits per char)
  const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ENC.indexOf(ch);
  assert.equal(t, at);
});

test("ulid() sorts by time", () => {
  const older = ulid(1780000000000);
  const newer = ulid(1780000000001);
  assert.ok(older < newer);
});

test("idfor is deterministic and distinct per key", () => {
  const a = ulidFromKey("https://www.douyin.com/video/z1");
  const b = ulidFromKey("https://www.douyin.com/video/z1");
  const c = ulidFromKey("https://www.douyin.com/video/z2");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(isUlid(a));
});

test("idfor pins the time part to zero", () => {
  const id = ulidFromKey("any key");
  assert.equal(id.slice(0, 10), "0000000000");
});

test("isUlid rejects lowercase, short, and non-Crockford ids", () => {
  assert.ok(!isUlid(ulid().toLowerCase()));
  assert.ok(!isUlid("01J8AAAA9TQZ8VZEWCSRGQKP2".slice(1)));
  assert.ok(!isUlid("01J8AAAA9TQZ8VZEWCSRGQKP2I")); // I is not in the alphabet
  assert.ok(!isUlid("01j8aaaa9tqz8vzewcsrgqkp2l"));
});
