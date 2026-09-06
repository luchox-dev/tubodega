import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'tubodega:public';

/**
 * No token, system pool. Only for the use cases that run before an
 * organization exists: registration, login, refresh (spec 07 §2, §5).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
