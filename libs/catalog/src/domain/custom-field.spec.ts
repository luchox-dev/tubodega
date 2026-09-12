import { CustomFieldDefinition, CustomFieldValues, CustomType } from '@app/catalog';
import { aCustomField } from '../../test/builders/a-custom-field.js';

/** C-7: the values validate against the definitions in force, and the only way
 *  to hold them is to have passed through that validation (spec 11 §10). */
describe('CustomFieldDefinition.validate', () => {
  it('TEXT takes a string and nothing else', () => {
    const def = aCustomField({ type: CustomType.TEXT });
    expect(def.validate('Ferretería Mundial').ok).toBe(true);
    expect(def.validate(12).ok).toBe(false);
  });

  it('NUMBER takes a number, and "12" is a client bug, not a number', () => {
    const def = aCustomField({ key: 'peso', type: CustomType.NUMBER });
    expect(def.validate(12).ok).toBe(true);
    expect(def.validate(0).ok).toBe(true);
    expect(def.validate('12').ok).toBe(false);
    expect(def.validate(Number.NaN).ok).toBe(false);
  });

  it('DATE takes an ISO string, because JSON has no date type', () => {
    const def = aCustomField({ key: 'revisado_el', type: CustomType.DATE });
    const parsed = def.validate('2026-09-12T00:00:00.000Z');
    expect(parsed.ok).toBe(true);
    expect((parsed as { value: Date }).value).toBeInstanceOf(Date);
    expect(def.validate('el martes').ok).toBe(false);
    expect(def.validate(new Date('nope')).ok).toBe(false);
  });

  it('BOOLEAN takes true or false, not "true"', () => {
    const def = aCustomField({ key: 'fragil', type: CustomType.BOOLEAN });
    expect(def.validate(false).ok).toBe(true);
    expect(def.validate('true').ok).toBe(false);
  });

  it('SELECT takes an option from the list', () => {
    const def = aCustomField({ key: 'familia', type: CustomType.SELECT, options: ['ferretería', 'aseo'] });
    expect(def.validate('aseo').ok).toBe(true);
    expect(def.validate('lácteos').ok).toBe(false);
  });

  it('a SELECT without options is not a definition at all', () => {
    const bad = aCustomField;
    expect(() => bad({ key: 'familia', type: CustomType.SELECT })).toThrow();
  });

  it('the error points at the field, so the form can mark it', () => {
    const def = aCustomField({ key: 'peso', type: CustomType.NUMBER });
    const r = def.validate('12');
    expect(r.ok).toBe(false);
    expect((r as { error: { errors: readonly { pointer: string; code: string }[] } }).error.errors).toEqual([
      { pointer: '/customFields/peso', code: 'expected-number' },
    ]);
  });
});

describe('CustomFieldValues.build', () => {
  const proveedor = aCustomField({ key: 'proveedor', type: CustomType.TEXT });
  const familia = aCustomField({ key: 'familia', type: CustomType.SELECT, options: ['ferretería'] });

  it('keeps what validates', () => {
    const r = CustomFieldValues.build([proveedor, familia], {
      proveedor: 'Mundial',
      familia: 'ferretería',
    });
    expect(r.ok).toBe(true);
    expect((r as { value: CustomFieldValues }).value.toJSON()).toEqual({
      proveedor: 'Mundial',
      familia: 'ferretería',
    });
  });

  it('an absent optional field is simply absent', () => {
    const r = CustomFieldValues.build([proveedor], {});
    expect(r.ok).toBe(true);
    expect((r as { value: CustomFieldValues }).value.size).toBe(0);
  });

  it('an absent required field is an error', () => {
    const required = aCustomField({ key: 'proveedor', type: CustomType.TEXT, required: true });
    const r = CustomFieldValues.build([required], {});
    expect(r.ok).toBe(false);
    expect((r as { error: { errors: readonly { code: string }[] } }).error.errors).toEqual([
      { pointer: '/customFields/proveedor', code: 'required' },
    ]);
  });

  it('a key nobody defined is an error, not a silent extra', () => {
    const r = CustomFieldValues.build([proveedor], { color: 'azul' });
    expect(r.ok).toBe(false);
    expect((r as { error: { errors: readonly { code: string }[] } }).error.errors).toEqual([
      { pointer: '/customFields/color', code: 'unknown-field' },
    ]);
  });

  it('reports every offending field at once, so the form marks them all', () => {
    const r = CustomFieldValues.build([proveedor, familia], { proveedor: 9, familia: 'lácteos', otro: 1 });
    expect(r.ok).toBe(false);
    expect((r as { error: { errors: readonly unknown[] } }).error.errors).toHaveLength(3);
  });

  it('a date comes back out as an ISO string, ready for the jsonb column', () => {
    const fecha = aCustomField({ key: 'revisado_el', type: CustomType.DATE });
    const r = CustomFieldValues.build([fecha], { revisado_el: '2026-09-12T00:00:00.000Z' });
    expect((r as { value: CustomFieldValues }).value.toJSON()).toEqual({
      revisado_el: '2026-09-12T00:00:00.000Z',
    });
  });

  it('rehydration trusts the row: it already passed build', () => {
    const values = CustomFieldValues.rehydrate({ proveedor: 'Mundial' });
    expect(values.get(proveedor.key)).toBe('Mundial');
    expect(CustomFieldValues.rehydrate(null).size).toBe(0);
  });

  it('withMetadata changes the label and leaves the type alone', () => {
    const renamed = familia.withMetadata({ label: 'Familia de producto', required: true });
    expect(renamed.label).toBe('Familia de producto');
    expect(renamed.required).toBe(true);
    expect(renamed.type).toBe(CustomType.SELECT);
    expect(renamed.options).toEqual(['ferretería']);
  });

  it('an empty set is still a set', () => {
    expect(CustomFieldValues.empty().size).toBe(0);
    expect(CustomFieldValues.empty().toJSON()).toEqual({});
  });
});

/** The defaults and the rehydration paths: boring, and exactly where a silent
 *  regression hides, because nothing above them would notice. */
describe('defaults and rehydration', () => {
  it('a definition is optional, first in the list and at version 1 unless told otherwise', () => {
    const def = aCustomField();
    expect(def.required).toBe(false);
    expect(def.position).toBe(0);
    expect(def.version).toBe(1);
    expect(def.options).toBeUndefined();
  });

  it('and takes the values it is given', () => {
    const def = aCustomField({ required: true, position: 3, label: '  Proveedor  ' });
    expect(def.required).toBe(true);
    expect(def.position).toBe(3);
    expect(def.label).toBe('Proveedor');
  });

  it('withMetadata with nothing to change changes nothing', () => {
    const def = aCustomField({ required: true, position: 2 });
    const same = def.withMetadata({});
    expect(same.label).toBe(def.label);
    expect(same.required).toBe(true);
    expect(same.position).toBe(2);
  });

  it('build with no values at all is an empty set', () => {
    const r = CustomFieldValues.build([]);
    expect(r.ok).toBe(true);
    expect((r as { value: CustomFieldValues }).value.size).toBe(0);
  });

  it('null is treated as absent, not as a value', () => {
    const def = aCustomField({ key: 'proveedor', type: CustomType.TEXT });
    expect(CustomFieldValues.build([def], { proveedor: null }).ok).toBe(true);
  });

  it('rehydration keeps the options of a SELECT', () => {
    const def = aCustomField({ key: 'familia', type: CustomType.SELECT, options: ['aseo'] });
    const back = CustomFieldDefinition.rehydrate({ ...def, options: def.options, version: 4 });
    expect(back.options).toEqual(['aseo']);
    expect(back.version).toBe(4);
  });
});

describe('the types that only accept one shape', () => {
  it('DATE refuses anything that is neither a Date nor a string', () => {
    const def = aCustomField({ key: 'revisado_el', type: CustomType.DATE });
    expect(def.validate(20260912).ok).toBe(false);
    expect(def.validate(null).ok).toBe(false);
  });

  it('SELECT refuses a non-string, not just an option outside the list', () => {
    const def = aCustomField({ key: 'familia', type: CustomType.SELECT, options: ['aseo'] });
    expect(def.validate(1).ok).toBe(false);
  });
});
