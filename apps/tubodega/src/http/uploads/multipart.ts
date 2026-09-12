import type { FastifyRequest } from 'fastify';
import { MediaTooLargeError } from '@app/catalog';

export interface UploadedFile {
  readonly bytes: Buffer;
  readonly contentType: string;
}

/**
 * Reads the files of a multipart request. `@fastify/multipart` enforces the
 * size limit while streaming and flags the part as truncated instead of
 * throwing, so the check has to happen per file, here — reading eleven
 * megabytes and refusing them afterwards is a denial of service waiting to
 * happen (spec 11 §9).
 */
export async function readFiles(req: FastifyRequest, max = 20): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for await (const part of req.parts()) {
    if (part.type !== 'file') continue;
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw new MediaTooLargeError();
    out.push({ bytes, contentType: part.mimetype });
    if (out.length >= max) break;
  }
  return out;
}

export const isMultipart = (req: FastifyRequest): boolean =>
  (req.headers['content-type'] ?? '').startsWith('multipart/form-data');
