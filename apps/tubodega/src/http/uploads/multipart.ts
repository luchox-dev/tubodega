import type { FastifyRequest } from 'fastify';
import { MediaTooLargeError } from '@app/catalog';

export interface UploadedFile {
  readonly bytes: Buffer;
  readonly contentType: string;
}

/** What `@fastify/multipart` raises when a part passes `limits.fileSize`. */
const FILE_TOO_LARGE = 'FST_REQ_FILE_TOO_LARGE';

const isTooLarge = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === FILE_TOO_LARGE;

/**
 * Reads the files of a multipart request. The size limit is enforced by the
 * plugin while streaming, so eleven megabytes are never fully read — but it
 * signals the overrun by throwing a FastifyError, which the exception filter
 * would turn into a 500. Translating it here is what makes the limit a
 * `413 media-too-large` the client can act on (spec 11 §9).
 *
 * `part.file.truncated` covers the other configuration of the plugin, where it
 * flags the part instead of throwing.
 */
export async function readFiles(req: FastifyRequest, max = 20): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for await (const part of req.parts()) {
    if (part.type !== 'file') continue;
    let bytes: Buffer;
    try {
      bytes = await part.toBuffer();
    } catch (e) {
      if (isTooLarge(e)) throw new MediaTooLargeError();
      throw e;
    }
    if (part.file.truncated) throw new MediaTooLargeError();
    out.push({ bytes, contentType: part.mimetype });
    if (out.length >= max) break;
  }
  return out;
}

export const isMultipart = (req: FastifyRequest): boolean =>
  (req.headers['content-type'] ?? '').startsWith('multipart/form-data');
