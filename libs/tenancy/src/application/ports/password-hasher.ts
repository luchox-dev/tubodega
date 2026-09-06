export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}
export const PASSWORD_HASHER = Symbol('PasswordHasher');
