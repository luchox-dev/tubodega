import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type { MediaStorage } from '../application/ports/media.js';
import type { StorageKey } from '../domain/ids.js';

export const MEDIA_ROOT = Symbol('MediaRoot');

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * The first implementation of MediaStorage: one file per photo under
 * `MEDIA_ROOT/<orgId>/<key>`. The key carries the organization so a key alone
 * cannot be used to read across tenants, and the path is checked against the
 * root before every write and delete — a key is user-adjacent data, and
 * `../../etc` is what that data looks like on a bad day.
 */
@Injectable()
export class DiskMediaStorage implements MediaStorage {
  constructor(@Inject(MEDIA_ROOT) private readonly root: string) {}

  async put(orgId: OrgId, bytes: Buffer, contentType: string): Promise<StorageKey> {
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const ext = EXTENSIONS[contentType] ?? 'bin';
    const key = `${orgId}/${randomUUID()}-${digest}.${ext}` as StorageKey;
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return key;
  }

  /** No signature yet: the MVP serves nothing publicly, and a URL that lies
   *  about being signed is worse than one that does not claim to be. */
  async signedUrl(key: StorageKey, ttlSeconds: number): Promise<string> {
    return `/v1/media/${key}?ttl=${ttlSeconds}`;
  }

  async delete(key: StorageKey): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: StorageKey): string {
    const root = resolve(this.root);
    const path = resolve(join(root, key));
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error(`storage key escapes MEDIA_ROOT: ${key}`);
    }
    return path;
  }
}
