import { Module } from '@nestjs/common';
import { PASSWORD_HASHER } from './application/ports/password-hasher.js';
import { RANDOM_TOKEN, TOKEN_ISSUER } from './application/ports/token-issuer.js';
import { Authenticate } from './application/use-cases/authenticate.js';
import { ChangePassword } from './application/use-cases/change-password.js';
import { CreateOrganization } from './application/use-cases/create-organization.js';
import { Logout } from './application/use-cases/logout.js';
import { RefreshSession } from './application/use-cases/refresh-session.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.js';
import { CryptoRandomToken } from './infrastructure/crypto-random-token.js';
import { JoseTokenIssuer } from './infrastructure/jose-token-issuer.js';

/**
 * Use cases and the technical adapters this library owns. Repositories,
 * clock, ids, event publisher and OrgProvisioner are bound by the root
 * application (spec 01 §6); they reach here through a global module.
 */
@Module({
  providers: [
    CreateOrganization,
    Authenticate,
    RefreshSession,
    Logout,
    ChangePassword,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOKEN_ISSUER, useClass: JoseTokenIssuer },
    { provide: RANDOM_TOKEN, useClass: CryptoRandomToken },
  ],
  exports: [
    CreateOrganization,
    Authenticate,
    RefreshSession,
    Logout,
    ChangePassword,
    TOKEN_ISSUER,
    PASSWORD_HASHER,
  ],
})
export class TenancyModule {}
