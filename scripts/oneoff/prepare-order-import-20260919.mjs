import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const XLSX = require('xlsx');
const root = 'E:/code2/biz-reporting-system-deploy';
const output = `${root}/.order-chunks/import-missing-20260919`;
fs.mkdirSync(output, { recursive: true });
const wb = XLSX.read(fs.readFileSync(`${root}/.tmp-orders.xlsx`), { type: 'buffer', cellDates: true });
const all = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
const stringify = value => value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')} ${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}:${String(value.getSeconds()).padStart(2,'0')}` : String(value ?? '').trim();
const rows = all.slice(1).map(r=>Array.from({length:34},(_,i)=>stringify(r[i]))).filter(r=>r.some(Boolean));
const hash = r=>createHash('sha256').update(r.join(String.fromCharCode(31))).digest('hex');
const counts = new Map(); for(const row of rows){ const h=hash(row); counts.set(h,(counts.get(h)||0)+1); }
const old = JSON.parse(fs.readFileSync(`${root}/.order-chunks/existing-row-hashes.json`,'utf8'));
let overlap=0; for(const r of old){ const n=counts.get(r.h)||0; if(n>0){overlap++;counts.set(r.h,n-1);} }
const oldCounts = new Map(); for(const r of old) oldCounts.set(r.h,(oldCounts.get(r.h)||0)+1);
const incoming=[]; const reused=[];
for(let i=0;i<rows.length;i++){const h=hash(rows[i]); const n=oldCounts.get(h)||0;if(n){oldCounts.set(h,n-1);reused.push(i+2);}else incoming.push({row:rows[i],sourceRow:i+2});}
const manifest = { sourceRows:rows.length, existingRows:old.length, overlap, newRows:incoming.length, sourceAmountFen:rows.reduce((a,r)=>a+Math.round(Number(r[5])*100),0), reusedSourceRows:reused, files:[] };
for(let start=0,i=1;start<incoming.length;start+=3000,i++){
 const entries=incoming.slice(start,start+3000); const part=entries.map(e=>e.row); const file=`orders-${String(i).padStart(3,'0')}.xlsx`;
 const b=XLSX.write({SheetNames:['Sheet1'],Sheets:{Sheet1:XLSX.utils.aoa_to_sheet([all[0],...part])}},{type:'buffer',bookType:'xlsx',compression:true});
 fs.writeFileSync(`${output}/${file}`,b);
 manifest.files.push({file,rows:part.length,sourceRows:entries.map(e=>e.sourceRow),sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length});
}
fs.writeFileSync(`${output}/manifest.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({sourceRows:rows.length,overlap,newRows:incoming.length,files:manifest.files.length,maxBytes:Math.max(...manifest.files.map(f=>f.bytes))}));
