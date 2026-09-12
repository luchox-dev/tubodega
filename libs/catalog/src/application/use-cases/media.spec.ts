import type { OrgId } from '@app/common';
import {
  TrackingMode,
  type MediaId, type MediaStorage, type MediaUploadRepository, type ProductId,
  type ProductMediaRepository, type StagedUpload, type StorageKey, type StoredMedia,
} from '@app/catalog';
import { Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import {
  InMemoryCustomFieldRepository, InMemoryProductCodeRepository, InMemoryProductRepository,
  RecordingEventPublisher, fakeIds, fixedClock,
} from '../../../test/doubles/in-memory.js';
import { AttachMedia } from './attach-media.js';
import { CreateProduct } from './create-product.js';
import { ListMedia } from './list-media.js';
import { RemoveMedia } from './remove-media.js';
import { StageUpload } from './stage-upload.js';

class FakeStorage implements MediaStorage {
  readonly files = new Map<string, Buffer>();
  private n = 0;
  async put(orgId: OrgId, bytes: Buffer): Promise<StorageKey> {
    const key = `${orgId}/file-${++this.n}` as StorageKey;
    this.files.set(key, bytes);
    return key;
  }
  async signedUrl(key: StorageKey): Promise<string> {
    return `/v1/media/${key}`;
  }
  async delete(key: StorageKey): Promise<void> {
    this.files.delete(key);
  }
}

class FakeUploads implements MediaUploadRepository {
  readonly staged = new Map<string, StagedUpload & { claimed: boolean }>();
  async stage(u: { storageKey: StorageKey; contentType: string; byteSize: number }): Promise<void> {
    this.staged.set(u.storageKey, { ...u, claimed: false });
  }
  async claim(_orgId: OrgId, keys: readonly StorageKey[]): Promise<StagedUpload[]> {
    const out: StagedUpload[] = [];
    for (const k of keys) {
      const row = this.staged.get(k);
      if (!row || row.claimed) continue;
      row.claimed = true;
      out.push({ storageKey: row.storageKey, contentType: row.contentType, byteSize: row.byteSize });
    }
    return out;
  }
  async listUnclaimedBefore(): Promise<{ orgId: OrgId; storageKey: StorageKey }[]> {
    return [];
  }
}

class FakeProductMedia implements ProductMediaRepository {
  readonly rows: StoredMedia[] = [];
  async listByProduct(_orgId: OrgId, productId: ProductId): Promise<StoredMedia[]> {
    return this.rows.filter((r) => r.productId === productId);
  }
  async attach(_orgId: OrgId, media: StoredMedia): Promise<void> {
    this.rows.push(media);
  }
  async remove(_orgId: OrgId, productId: ProductId, mediaId: MediaId): Promise<StorageKey | null> {
    const i = this.rows.findIndex((r) => r.id === mediaId && r.productId === productId);
    if (i < 0) return null;
    return this.rows.splice(i, 1)[0]!.storageKey;
  }
}

const PNG = { bytes: Buffer.from('png'), contentType: 'image/png' };

const build = () => {
  const products = new InMemoryProductRepository();
  const storage = new FakeStorage();
  const uploads = new FakeUploads();
  const media = new FakeProductMedia();
  return {
    products, storage, uploads, media,
    create: new CreateProduct(
      products, new InMemoryProductCodeRepository(), new InMemoryCustomFieldRepository(),
      new RecordingEventPublisher(), fakeIds, fixedClock,
    ),
    stage: new StageUpload(storage, uploads, fixedClock),
    attach: new AttachMedia(products, media, uploads, storage, fakeIds),
    remove: new RemoveMedia(products, media, storage),
    list: new ListMedia(products, media),
  };
};

const NEW = { sku: 'TOR-M8', name: 'Tornillo', trackingMode: TrackingMode.QUANTITY, uom: 'UNIT' };

describe('StageUpload · the waiting room', () => {
  it('an OPERATOR uploads a photo before anyone decides where it belongs (D-14)', async () => {
    const t = build();
    const { storageKey, expiresAt } = await t.stage.execute(aContext([Role.OPERATOR]), PNG);
    expect(t.storage.files.has(storageKey)).toBe(true);
    expect(expiresAt.getTime() - fixedClock.now().getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('a VIEWER does not', async () => {
    const t = build();
    await expect(t.stage.execute(aContext([Role.VIEWER]), PNG)).rejects.toMatchObject({
      type: 'insufficient-role',
    });
  });

  it('only jpeg, png and webp', async () => {
    const t = build();
    await expect(
      t.stage.execute(aContext(), { bytes: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toMatchObject({ type: 'unsupported-media-type', status: 415 });
  });

  it('ten megabytes is the limit', async () => {
    const t = build();
    const big = { bytes: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: 'image/png' };
    await expect(t.stage.execute(aContext(), big)).rejects.toMatchObject({
      type: 'media-too-large',
      status: 413,
    });
  });
});

describe('AttachMedia', () => {
  it('an OPERATOR claims the keys they staged (D-14)', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const { storageKey } = await t.stage.execute(aContext([Role.OPERATOR]), PNG);
    const attached = await t.attach.execute(aContext([Role.OPERATOR]), {
      productId: p.id,
      storageKeys: [storageKey],
    });
    expect(attached).toHaveLength(1);
    expect(await t.list.execute(aContext(), p.id)).toHaveLength(1);
  });

  it('but uploading straight onto the product is a catalogue change', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    await expect(
      t.attach.execute(aContext([Role.OPERATOR]), { productId: p.id, files: [PNG] }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
    await expect(
      t.attach.execute(aContext(), { productId: p.id, files: [PNG] }),
    ).resolves.toHaveLength(1);
  });

  it('a key nobody staged is upload-not-found', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    await expect(
      t.attach.execute(aContext(), { productId: p.id, storageKeys: ['inventada' as StorageKey] }),
    ).rejects.toMatchObject({ type: 'upload-not-found', status: 422 });
  });

  it('and a key somebody already claimed is the same answer', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const { storageKey } = await t.stage.execute(aContext(), PNG);
    await t.attach.execute(aContext(), { productId: p.id, storageKeys: [storageKey] });
    await expect(
      t.attach.execute(aContext(), { productId: p.id, storageKeys: [storageKey] }),
    ).rejects.toMatchObject({ type: 'upload-not-found' });
    expect(await t.list.execute(aContext(), p.id)).toHaveLength(1);
  });

  it('reports the lost keys before attaching anything, so nothing lands half-done', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const { storageKey } = await t.stage.execute(aContext(), PNG);
    await expect(
      t.attach.execute(aContext(), { productId: p.id, storageKeys: [storageKey, 'no' as StorageKey] }),
    ).rejects.toMatchObject({ type: 'upload-not-found' });
    expect(await t.list.execute(aContext(), p.id)).toEqual([]);
  });

  it('positions the photos one after another', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    await t.attach.execute(aContext(), { productId: p.id, files: [PNG, PNG] });
    await t.attach.execute(aContext(), { productId: p.id, files: [PNG] });
    expect((await t.list.execute(aContext(), p.id)).map((m) => m.position)).toEqual([0, 1, 2]);
  });

  it('checks the type and the size of a direct upload too', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    await expect(
      t.attach.execute(aContext(), { productId: p.id, files: [{ bytes: Buffer.from('x'), contentType: 'application/pdf' }] }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      t.attach.execute(aContext(), {
        productId: p.id,
        files: [{ bytes: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: 'image/png' }],
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('a product that is not there is a 404, whichever way the photo arrives', async () => {
    const t = build();
    await expect(
      t.attach.execute(aContext(), { productId: 'nope' as ProductId, files: [PNG] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(t.list.execute(aContext(), 'nope' as ProductId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('RemoveMedia', () => {
  it('takes the photo off the product and deletes the file', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const [attached] = await t.attach.execute(aContext(), { productId: p.id, files: [PNG] });
    await t.remove.execute(aContext(), p.id, attached!.id);
    expect(await t.list.execute(aContext(), p.id)).toEqual([]);
    expect(t.storage.files.has(attached!.storageKey)).toBe(false);
  });

  it('a photo that is not there is a 404, and so is one of another product', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const other = await t.create.execute(aContext(), { ...NEW, sku: 'OTRO-1' });
    const [attached] = await t.attach.execute(aContext(), { productId: p.id, files: [PNG] });
    await expect(t.remove.execute(aContext(), p.id, 'nope' as MediaId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(t.remove.execute(aContext(), other.id, attached!.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('an OPERATOR does not remove catalogue photos', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const [attached] = await t.attach.execute(aContext(), { productId: p.id, files: [PNG] });
    await expect(
      t.remove.execute(aContext([Role.OPERATOR]), p.id, attached!.id),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });
});
