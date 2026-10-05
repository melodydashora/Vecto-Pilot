import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

function normalizeType(type) {
  return type.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\s+\(/g, '(')
    .replace(/\s*,\s*/g, ',').replace(/^serial$/, 'integer')
    .replace(/^bigserial$/, 'bigint').replace(/^smallserial$/, 'smallint')
    .replace(/^varchar\b/, 'character varying').replace(/^char\b/, 'character')
    .replace(/^timestamp(?:\((\d+)\))?(?: (with|without) time zone)?(\[\])?$/,
      (_match, precision, zone, array) => `timestamp${precision && precision !== '6' ? `(${precision})` : ''} ${zone ?? 'without'} time zone${array ?? ''}`);
}
const baseType = type => type.replace(/\([^)]*\)/g, '');
const ARRAY_ELEMENT_TYPES = { int2: 'smallint', int4: 'integer', int8: 'bigint',
  float4: 'real', float8: 'double precision', bool: 'boolean', varchar: 'character varying',
  bpchar: 'character', timestamptz: 'timestamp with time zone', timestamp: 'timestamp without time zone' };

function databaseType(column) {
  // format_type preserves varchar limits and numeric precision/scale. The CLI
  // always supplies it; older callers can still compare base scalar types.
  if (column.formatted_type) return normalizeType(column.formatted_type);
  if (column.data_type !== 'ARRAY') return normalizeType(column.data_type);
  if (!column.udt_name?.startsWith('_')) return 'ARRAY (element type unavailable)';
  const element = column.udt_name.slice(1);
  return `${ARRAY_ELEMENT_TYPES[element] ?? element}[]`;
}

export function compareSchemaMetadata(schema, rows, { checks } = {}) {
  // Legacy aliases may export the exact same table object more than once.
  const tables = [...new Set(Object.values(schema).filter(value => is(value, PgTable)))].map(getTableConfig);
  const actual = new Map(rows.map(row => [`${row.table_name}.${row.column_name}`, row]));
  const missing = [], looser = [], stricter = [], types = [];
  let columns = 0;
  for (const table of tables) for (const column of table.columns) {
    columns++;
    const key = `${table.name}.${column.name}`;
    const found = actual.get(key);
    if (!found) { missing.push(key); continue; }
    if (column.notNull && found.is_nullable === 'YES') looser.push(key);
    if (!column.notNull && found.is_nullable === 'NO') stricter.push(key);
    const declared = normalizeType(column.getSQLType());
    const expected = found.formatted_type ? declared : baseType(declared);
    const actualType = databaseType(found);
    if (expected !== actualType) types.push({ column: key, expected, actual: actualType });
  }
  const declaredChecks = new Set(tables.flatMap(table => table.checks.map(check => `${table.name}.${check.name}`)));
  const tableNames = new Set(tables.map(table => table.name));
  const relevantChecks = (checks ?? []).filter(check => tableNames.has(check.table_name));
  const actualChecks = new Set(relevantChecks.map(check => `${check.table_name}.${check.constraint_name}`));
  return { declaredTables: tables.length, declaredColumns: columns, missingDeclaredColumns: missing,
    looserDatabaseNullability: looser, stricterDatabaseNullability: stricter, typeDifferences: types,
    checkConstraintsCompared: checks !== undefined,
    missingDeclaredChecks: checks === undefined ? [] : [...declaredChecks].filter(key => !actualChecks.has(key)).sort(),
    undeclaredDatabaseChecks: [...actualChecks].filter(key => !declaredChecks.has(key)).sort(),
    unvalidatedChecks: relevantChecks.filter(check => check.validated === false)
      .map(check => `${check.table_name}.${check.constraint_name}`).sort(),
  };
}

export function hasSchemaDrift(result) {
  return ['missingDeclaredColumns', 'looserDatabaseNullability', 'stricterDatabaseNullability',
    'typeDifferences', 'missingDeclaredChecks', 'undeclaredDatabaseChecks', 'unvalidatedChecks']
    .some(key => result[key]?.length > 0);
}
