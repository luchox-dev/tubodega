import { DomainError } from '@app/common';

/** The three media errors of spec 11 §9. */

export const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** 10 MB per image. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export class UnsupportedMediaTypeError extends DomainError {
  readonly type = 'unsupported-media-type';
  readonly status = 415;
  constructor(given: string) {
    super(`"${given}" no se admite: solo ${ALLOWED_MEDIA_TYPES.join(', ')}`);
  }
}

export class MediaTooLargeError extends DomainError {
  readonly type = 'media-too-large';
  readonly status = 413;
  constructor() {
    super(`La imagen supera el máximo de ${MAX_MEDIA_BYTES / 1024 / 1024} MB`);
  }
}

/** A key that was never in the waiting room, or that somebody already claimed. */
export class UploadNotFoundError extends DomainError {
  readonly type = 'upload-not-found';
  readonly status = 422;
  constructor(keys: readonly string[]) {
    super(
      keys.length === 1
        ? `La clave "${keys[0]}" no está en la zona de espera o ya fue reclamada`
        : `${keys.length} claves no están en la zona de espera o ya fueron reclamadas`,
      { extensions: { storageKeys: [...keys] } },
    );
  }
}

export class MediaNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No se encontró la imagen');
  }
}
