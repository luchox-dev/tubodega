import { unwrap } from '@app/common';
import { TemplateCode } from './ids.js';

describe('TemplateCode', () => {
  it('acepta los seis códigos de fábrica', () => {
    for (const code of ['RECEPCION', 'TRASLADO', 'SALIDA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CUSTODIA']) {
      expect(unwrap(TemplateCode.of(code))).toBe(code);
    }
  });

  it('recorta los espacios de los extremos', () => {
    expect(unwrap(TemplateCode.of('  RECEPCION  '))).toBe('RECEPCION');
  });

  it('admite justo 64 caracteres, que es lo que cabe en la columna', () => {
    expect(TemplateCode.of('A'.repeat(64)).ok).toBe(true);
  });

  // Un varchar(64) rebosado no es un 500 de la base: es una plantilla que no existe.
  it('rechaza 65, el vacío y el código con barra', () => {
    for (const raw of ['A'.repeat(65), '', '   ', 'AJUSTE/ENTRADA']) {
      const r = TemplateCode.of(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.type).toBe('invalid-template-code');
    }
  });

  it('el error apunta a /code', () => {
    const r = TemplateCode.of('');
    expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/code');
  });
});
