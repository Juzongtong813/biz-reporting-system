import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const SRC = 'E:/code2/biz-reporting-system-deploy/apps/api/src';
const DB = 'E:/code2/biz-reporting-system-deploy/.artifacts/manual-test/manual.sqlite';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.entity.ts')) out.push(p);
  }
  return out;
}

function sqliteType(t) {
  switch ((t || '').toLowerCase()) {
    case 'int': case 'integer': case 'bigint': case 'smallint': case 'tinyint':
      return 'INTEGER';
    case 'float': case 'double': case 'decimal': case 'real': case 'numeric':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    default:
      return 'TEXT';
  }
}

const files = walk(SRC);
const plan = []; // { table, col, sqlType }
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const ent = src.match(/@Entity\(\s*['"]([^'"]+)['"]\s*\)/);
  if (!ent) continue;
  const table = ent[1];
  // match decorator (Column/PrimaryColumn/CreateDateColumn/UpdateDateColumn) possibly multiline, then property name
  const re = /@(PrimaryColumn|CreateDateColumn|UpdateDateColumn|Column)\s*\(\s*(\{[\s\S]*?\})?\s*\)\s*([A-Za-z_$][\w$]*)\s*[:?]/g;
  let m;
  while ((m = re.exec(src))) {
    const dec = m[1];
    const opts = m[2] || '';
    const prop = m[3];
    const nameM = opts.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const typeM = opts.match(/type\s*:\s*['"]([^'"]+)['"]/);
    const colName = nameM ? nameM[1] : prop;
    let type;
    if (dec === 'CreateDateColumn' || dec === 'UpdateDateColumn') type = 'datetime';
    else if (typeM) type = typeM[1];
    else type = 'varchar';
    plan.push({ table, col: colName, sqlType: sqliteType(type) });
  }
}

const db = new Database(DB);
db.pragma('foreign_keys = OFF');
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));

let added = 0;
for (const { table, col, sqlType } of plan) {
  if (!tables.has(table)) continue;
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (existing.includes(col)) continue;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlType}`);
    added++;
    console.log(`ADDED ${table}.${col} (${sqlType})`);
  } catch (e) {
    console.log(`FAIL  ${table}.${col}: ${e.message}`);
  }
}
db.close();
console.log(`\nTotal columns added: ${added}`);
