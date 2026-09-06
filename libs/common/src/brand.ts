/** Nominal typing: a `UserId` and an `OrgId` are both strings, but not interchangeable. Spec 01 §4. */
export type Branded<T, K extends string> = T & { readonly __brand: K };
