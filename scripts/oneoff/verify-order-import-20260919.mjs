import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const XLSX = require('xlsx');
const root='E:/code2/biz-reporting-system-deploy';
const dir=`${root}/.order-chunks/import-missing-20260919`;
const manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`,'utf8'));
const results=JSON.parse(fs.readFileSync(`${dir}/results.json`,'utf8'));
const database=JSON.parse(fs.readFileSync(`${dir}/database-row-audit.json`,'utf8'));
const wb=XLSX.read(fs.readFileSync(`${root}/.tmp-orders.xlsx`),{type:'buffer',cellDates:true});
const stringify=v=>v instanceof Date?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')} ${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}:${String(v.getSeconds()).padStart(2,'0')}`:String(v??'').trim();
const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:true,defval:''}).slice(1).map(r=>Array.from({length:34},(_,i)=>stringify(r[i]))).filter(r=>r.some(Boolean));
const hash=r=>createHash('sha256').update(r.join(String.fromCharCode(31))).digest('hex');
const oldBatch='5559b3d6-0b12-4193-8351-7d05d333bcaf';
const existing=new Map(); const newRows=new Map();
for(const r of database){if(r.batch_id===oldBatch){const list=existing.get(r.h)||[];list.push(r);existing.set(r.h,list);}else newRows.set(`${r.batch_id}:${r.source_row_no}`,r);}
const mapping=[];
for(const f of manifest.files){const result=results.find(r=>r.file===f.file);assert.ok(result);assert.equal(result.totalRows,f.rows); for(let i=0;i<f.rows;i++){const sourceRow=f.sourceRows[i];const row=newRows.get(`${result.batchId}:${i+2}`);assert.ok(row);assert.equal(row.h,hash(rows[sourceRow-2]));mapping.push({sourceRow,databaseId:row.id,status:row.validation_status,completionFen:row.completion_amount_fen});}}
for(const sourceRow of manifest.reusedSourceRows){const h=hash(rows[sourceRow-2]);const row=existing.get(h)?.shift();assert.ok(row,'existing match must exist');mapping.push({sourceRow,databaseId:row.id,status:row.validation_status,completionFen:row.completion_amount_fen});}
assert.equal(mapping.length,147798);assert.equal(new Set(mapping.map(r=>r.sourceRow)).size,147798);assert.equal(new Set(mapping.map(r=>r.databaseId)).size,147798);
const summary={sourceRows:mapping.length,newRows:manifest.newRows,reusedRows:manifest.overlap,validRows:mapping.filter(r=>r.status==='valid').length,reviewRows:mapping.filter(r=>r.status==='needs_review').length,sourceAmountFen:manifest.sourceAmountFen,validAmountFen:mapping.filter(r=>r.status==='valid').reduce((s,r)=>s+Number(r.completionFen),0),allDatabaseValidRows:database.filter(r=>r.validation_status==='valid').length,allDatabaseValidAmountFen:database.filter(r=>r.validation_status==='valid').reduce((s,r)=>s+Number(r.completion_amount_fen),0),verifiedAt:new Date().toISOString()};
fs.writeFileSync(`${dir}/source-row-mapping.json`,JSON.stringify(mapping));fs.writeFileSync(`${dir}/verification.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
