/** Architecture rules R-1..R-4 of docs/specs/01-arquitectura.md §5, enforced by `pnpm lint`. */
module.exports = {
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(spec|int-spec|e2e-spec|prop-spec)\\.ts$' },
  },
  forbidden: [
    {
      name: 'R-1 domain-is-pure',
      comment: 'Nothing under domain/ imports Nest, Kysely, pg, Prisma, Fastify, application/ or infrastructure/.',
      severity: 'error',
      from: { path: '^libs/[^/]+/src/domain/' },
      to: {
        path: [
          'node_modules/(@nestjs|kysely|pg|@prisma|prisma|fastify)/',
          '^libs/[^/]+/src/(application|infrastructure)/',
        ],
      },
    },
    { name: 'R-2 no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'R-2 dependency-order',
      comment: 'tenancy → nothing; catalog → tenancy; inventory → tenancy, catalog; process/alerts → those three.',
      severity: 'error',
      from: { path: '^libs/tenancy/' },
      to: { path: '^libs/(catalog|inventory|process|alerts)/' },
    },
    {
      name: 'R-2 dependency-order-catalog',
      severity: 'error',
      from: { path: '^libs/catalog/' },
      to: { path: '^libs/(inventory|process|alerts)/' },
    },
    {
      name: 'R-2 dependency-order-inventory',
      severity: 'error',
      from: { path: '^libs/inventory/' },
      to: { path: '^libs/(process|alerts)/' },
    },
    {
      name: 'R-3 only-barrels',
      comment: 'A context imports @app/<lib> (its index.ts), never an internal path of another library.',
      severity: 'error',
      from: { path: '^(apps|libs)/([^/]+)/' },
      to: { path: '^libs/(?!$2/)[^/]+/src/(?!index\\.ts$).+' },
    },
    {
      name: 'R-4 persistence-not-imported',
      comment: 'libs/persistence implements ports; no domain library may import it.',
      severity: 'error',
      from: { path: '^libs/(?!persistence/)' },
      to: { path: '^libs/persistence/' },
    },
  ],
};
