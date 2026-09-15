import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

const normalizeType = type => type.toLowerCase().replace(/\(.*\)/g, '')
  .replace(/^serial$/, 'integer').replace(/^varchar$/, 'character varying')
  .replace(/^timestamp$/, 'timestamp without time zone');

export function compareSchemaMetadata(schema, rows) {
  const tables = Object.values(schema).filter(value => is(value, PgTable)).map(getTableConfig);
  const actual = new Map(rows.map(row => [`${row.table_name}.${row.column_name}`, row]));
  const missing = [], nullability = [], types = [];
  let columns = 0;
  for (const table of tables) for (const column of table.columns) {
    columns++;
    const key = `${table.name}.${column.name}`;
    const found = actual.get(key);
    if (!found) { missing.push(key); continue; }
    if (column.notNull && found.is_nullable === 'YES') nullability.push(key);
    const expected = normalizeType(column.getSQLType());
    if (expected !== found.data_type && !(expected.endsWith('[]') && found.data_type === 'ARRAY')) {
      types.push({ column: key, expected, actual: found.data_type });
    }
  }
  return { declaredTables: tables.length, declaredColumns: columns, missingDeclaredColumns: missing,
    looserDatabaseNullability: nullability, typeDifferences: types };
}
