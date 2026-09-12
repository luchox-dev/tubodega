import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import {
  ALLOWED_MEDIA_TYPES, MAX_MEDIA_BYTES, MediaTooLargeError, UnsupportedMediaTypeError,
} from '../../domain/media-errors.js';
import type { StorageKey } from '../../domain/ids.js';
import {
  MEDIA_STORAGE, MEDIA_UPLOAD_REPOSITORY,
  type MediaStorage, type MediaUploadRepository,
} from '../ports/media.js';

/** Unclaimed keys are purged after this long, with their files (spec 07 §6). */
const WAITING_ROOM_MS = 24 * 60 * 60 * 1000;

/**
 * The waiting room. A process captures photos *before* knowing whether it will
 * be confirmed, and the operator taking them does not hold MANAGE_CATALOG —
 * hence RECORD_MOVEMENT (decision D-14). The photo belongs to no product yet.
 */
@Injectable()
export class StageUpload {
  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(MEDIA_UPLOAD_REPOSITORY) private readonly uploads: MediaUploadRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    ctx: RequestContext,
    file: { bytes: Buffer; contentType: string },
  ): Promise<{ storageKey: StorageKey; expiresAt: Date }> {
    requireAction(ctx, Action.RECORD_MOVEMENT);
    if (!(ALLOWED_MEDIA_TYPES as readonly string[]).includes(file.contentType)) {
      throw new UnsupportedMediaTypeError(file.contentType);
    }
    if (file.bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaTooLargeError();

    const storageKey = await this.storage.put(ctx.orgId, file.bytes, file.contentType);
    await this.uploads.stage({
      orgId: ctx.orgId,
      storageKey,
      contentType: file.contentType,
      byteSize: file.bytes.byteLength,
      uploadedBy: ctx.userId,
    });
    return { storageKey, expiresAt: new Date(this.clock.now().getTime() + WAITING_ROOM_MS) };
  }
}
