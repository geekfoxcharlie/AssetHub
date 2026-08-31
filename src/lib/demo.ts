import { existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { Hub, type PutInput, type PutResult } from "./hub.js";
import { nsDir, nsSchemasDir, schemaFileName } from "./paths.js";

// ---------------------------------------------------------------- placeholder PNGs

let crcTable: number[] | null = null;

function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** A solid-color PNG generated locally — no network, valid bytes, distinct hashes per color. */
export function makePng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- project schemas

export const NS = "douyin-hub";

const BLOGGER_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "assethub:douyin_blogger",
  title: "抖音博主",
  description: "A Douyin blogger profile collected into the hub.",
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    bio: { type: "string" },
    url: { type: "string", format: "uri" },
    followers: { type: "integer", minimum: 0 },
    following: { type: "integer", minimum: 0 },
  },
  "x-assethub": { view: "record" },
} as const;

const VIDEO_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "assethub:douyin_video",
  title: "抖音视频",
  description: "A Douyin video post: copy, metrics, cover images.",
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string", minLength: 1 },
    author: { type: "string" },
    platform: { type: "string" },
    url: { type: "string", format: "uri" },
    published_at: { type: "string", format: "date-time" },
    metrics: { type: "object", additionalProperties: { type: "number" } },
    tags: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
  },
  "x-assethub": { view: "card" },
} as const;

export const DEMO_SCHEMAS: Record<string, Record<string, unknown>> = {
  douyin_blogger: BLOGGER_SCHEMA as unknown as Record<string, unknown>,
  douyin_video: VIDEO_SCHEMA as unknown as Record<string, unknown>,
};

// ---------------------------------------------------------------- scenario

function ensureProjectSchema(hub: Hub, root: string, id: string, schema: Record<string, unknown>): void {
  const target = path.join(nsSchemasDir(root, NS), schemaFileName(id));
  if (existsSync(target)) return;
  hub.addSchema(id, schema, NS);
}

export interface SeededRecord {
  id: string;
  schema: string;
  path: string;
  files: string[];
}

export interface DemoResult {
  root: string;
  namespace: string;
  schemas: string[];
  records: SeededRecord[];
}

/**
 * Seed the reference douyin-hub scenario. Ids come from idfor, so rerunning
 * replaces records in place instead of duplicating them.
 */
export function seedDemo(root: string): DemoResult {
  const hub = new Hub(root);
  if (!existsSync(nsDir(root, NS))) {
    hub.addNamespace(NS, { name: "抖音 Hub", goal: "抖音博主内容采集" });
  }
  for (const [id, schema] of Object.entries(DEMO_SCHEMAS)) {
    ensureProjectSchema(hub, root, id, schema);
  }

  const avatar = makePng(96, 96, [63, 81, 181]);
  const coverZ1 = makePng(320, 180, [233, 110, 76]);
  const extraZ1 = makePng(320, 180, [46, 125, 110]);
  const coverL1 = makePng(320, 180, [122, 92, 178]);

  const puts: PutInput[] = [
    {
      ns: NS,
      dir: "zhangsan",
      id: hub.idfor("douyin:blogger:zhangsan"),
      schemaId: "douyin_blogger",
      data: {
        name: "张三 zhangsan",
        bio: "记录城市街头摄影与日常随想,每周更新。",
        url: "https://www.douyin.com/user/zhangsan",
        followers: 128000,
        following: 356,
      },
      files: [{ name: "avatar.png", bytes: avatar }],
    },
    {
      ns: NS,
      dir: "zhangsan/posts",
      id: hub.idfor("douyin:video:z1"),
      schemaId: "douyin_video",
      data: {
        content: "清晨的市场,摊主们支起摊位,雾气里全是烟火气。完整视频见主页。#街头摄影 #城市观察",
        author: "zhangsan",
        platform: "douyin",
        url: "https://www.douyin.com/video/z1",
        published_at: "2026-08-20T09:12:00.000Z",
        metrics: { likes: 12400, comments: 356, shares: 89, collects: 1024 },
        tags: ["街头摄影", "城市观察"],
      },
      files: [
        { name: "cover.png", bytes: coverZ1 },
        { name: "01.png", bytes: extraZ1 },
      ],
    },
    {
      ns: NS,
      dir: "zhangsan/posts",
      id: hub.idfor("douyin:video:z2"),
      schemaId: "douyin_video",
      data: {
        content: "镜头之外的笔记:拍了两百条视频之后,我开始随身带纸笔。",
        author: "zhangsan",
        platform: "douyin",
        url: "https://www.douyin.com/video/z2",
        published_at: "2026-08-24T21:40:00.000Z",
        metrics: { likes: 8300, comments: 192, shares: 41 },
        tags: ["创作笔记"],
      },
    },
    {
      ns: NS,
      dir: "lisi/posts",
      id: hub.idfor("douyin:video:l1"),
      schemaId: "douyin_video",
      data: {
        content: "周末去山里徒步,风把云吹得很快,运气好还能看到云海。",
        author: "lisi",
        platform: "douyin",
        url: "https://www.douyin.com/video/l1",
        published_at: "2026-08-26T06:05:00.000Z",
        metrics: { likes: 5100, comments: 98, shares: 22 },
        tags: ["徒步", "山野"],
      },
      files: [{ name: "cover.png", bytes: coverL1 }],
    },
  ];

  const records: SeededRecord[] = [];
  for (const input of puts) {
    const result: PutResult = hub.put(input);
    records.push({ id: result.record.id, schema: result.record.schema, path: result.path, files: result.record.files.map((f) => f.name) });
  }

  return { root, namespace: NS, schemas: Object.keys(DEMO_SCHEMAS).sort(), records };
}
