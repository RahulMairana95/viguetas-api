import 'dotenv/config';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const sql = postgres(process.env.DATABASE_URL, { prepare: false, connect_timeout: 20 });

const schemaSrc = readFileSync('./src/db/schema.ts', 'utf8');

// parse expected: pgTable('name', { ... col: type('col_name') ...
const expected = {};
const tableRe = /pgTable\('([a-z_]+)'/g;
const lines = schemaSrc.split('\n');
let current = null;
let depth = 0;
for (const line of lines) {
  const m = line.match(/pgTable\('([a-z_]+)'/);
  if (m) { current = m[1]; expected[current] = []; continue; }
  if (!current) continue;
  if (/^\}\);/.test(line.trim())) { current = null; continue; }
  const cm = line.match(/^\s{4}\w+:\s*\w+\('([a-z_0-9]+)'/);
  if (cm) expected[current].push(cm[1]);
}

async function main() {
  const enums = await sql`
    select t.typname as enum_name, array_agg(e.enumlabel order by e.enumsortorder) as values
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace where n.nspname='public'
    group by t.typname`;
  console.log('ENUMS:', JSON.stringify(enums));

  const tables = await sql`
    select table_name from information_schema.tables where table_schema='public' order by 1`;
  const dbTables = tables.map((t) => t.table_name);

  for (const [table, cols] of Object.entries(expected)) {
    if (!dbTables.includes(table)) { console.log(`MISSING TABLE: ${table}`); continue; }
    const dbCols = await sql`
      select column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
      from information_schema.columns where table_schema='public' and table_name=${table} order by ordinal_position`;
    const dbNames = dbCols.map((c) => c.column_name);
    const missing = cols.filter((c) => !dbNames.includes(c));
    const extra = dbNames.filter((c) => !cols.includes(c));
    if (missing.length || extra.length) {
      console.log(`TABLE ${table}: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
    } else {
      console.log(`TABLE ${table}: OK (${cols.length} cols)`);
    }
  }

  const extraTables = dbTables.filter((t) => !(t in expected));
  if (extraTables.length) console.log('EXTRA TABLES IN DB:', extraTables);

  // fks
  const fks = await sql`
    select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
    from pg_constraint where contype='f' and connamespace='public'::regnamespace order by 1`;
  console.log('FKS:', fks.length);
  fks.forEach((f) => console.log('  ', f.tbl, f.def));

  // indexes
  const idx = await sql`
    select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by 1`;
  console.log('INDEXES:');
  idx.forEach((i) => console.log('  ', i.indexname, '::', i.indexdef));
}

main().catch((e) => console.error('ERROR:', e.message)).finally(() => sql.end());
