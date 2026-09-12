import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OrgId } from '@app/common';
import { DiskMediaStorage, type StorageKey } from '@app/catalog';

describe('DiskMediaStorage', () => {
  const orgId = '018f0000-0000-7000-8000-000000000001' as OrgId;
  let root: string;
  let storage: DiskMediaStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tubodega-media-'));
    storage = new DiskMediaStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('writes the bytes under MEDIA_ROOT/<orgId>/', async () => {
    const bytes = Buffer.from('PNG-ish');
    const key = await storage.put(orgId, bytes, 'image/png');
    expect(key.startsWith(`${orgId}/`)).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
    expect(await readFile(join(root, key))).toEqual(bytes);
  });

  it('gives each upload its own key, even for identical bytes', async () => {
    const bytes = Buffer.from('same');
    const a = await storage.put(orgId, bytes, 'image/jpeg');
    const b = await storage.put(orgId, bytes, 'image/jpeg');
    expect(a).not.toBe(b);
  });

  it('deletes, and deleting twice is not an error', async () => {
    const key = await storage.put(orgId, Buffer.from('x'), 'image/webp');
    await storage.delete(key);
    await expect(stat(join(root, key))).rejects.toThrow();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('refuses a key that climbs out of the root', async () => {
    await expect(storage.delete('../../etc/passwd' as StorageKey)).rejects.toThrow(/escapes MEDIA_ROOT/);
  });

  it('hands back a url that does not pretend to be signed yet', async () => {
    const key = await storage.put(orgId, Buffer.from('x'), 'image/png');
    expect(await storage.signedUrl(key, 60)).toBe(`/v1/media/${key}?ttl=60`);
  });
});
