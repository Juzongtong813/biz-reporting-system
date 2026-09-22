import fs from 'node:fs';
import { createHash } from 'node:crypto';
const api='https://biz-reporting-api-315598-12-1362656322.sh.run.tcloudbase.com/api';
const dir='E:/code2/biz-reporting-system-deploy/.order-chunks/import-missing-20260919';
const manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`,'utf8'));
if(manifest.sourceRows!==147798 || manifest.overlap+manifest.newRows!==manifest.sourceRows) throw Error('source reconciliation failed');
const resultsFile=`${dir}/results.json`;
const results=fs.existsSync(resultsFile)?JSON.parse(fs.readFileSync(resultsFile,'utf8')):[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const login=await fetch(`${api}/biz/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ORDER_IMPORT_PASSWORD}),signal:AbortSignal.timeout(60000)});
if(!login.ok)throw Error(`login HTTP ${login.status}`); const token=(await login.json()).accessToken;
async function request(path,options={}){
 const r=await fetch(api+path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(180000)});
 const t=await r.text();if(!r.ok)throw Error(`HTTP ${r.status}: ${t.slice(0,400)}`);return JSON.parse(t);
}
const max=Number(process.env.ORDER_IMPORT_MAX_FILES)||manifest.files.length;
for(const part of manifest.files.slice(0,max)){
 if(results.some(r=>r.file===part.file && r.status==='imported'))continue;
 const buf=fs.readFileSync(`${dir}/${part.file}`);
 if(createHash('sha256').update(buf).digest('hex')!==part.sha256)throw Error('file hash mismatch');
 const key=`orders-20260919-${part.sha256.slice(0,40)}`;
 let batch=(await request('/biz/orders/batches')).items.find(b=>b.idempotencyKey===key);
 if(!batch){const form=new FormData();form.append('file',new Blob([buf]),`orders-2024-2026-${part.file}`);form.append('idempotencyKey',key);const up=await request('/biz/orders/upload',{method:'POST',body:form});batch={id:up.batchId,status:up.status};}
 const deadline=Date.now()+900000;
 while(batch.status==='parsing' && Date.now()<deadline){await sleep(3000);batch=(await request('/biz/orders/batches')).items.find(b=>b.id===batch.id);if(!batch)throw Error('batch missing');}
 if(batch.status!=='imported')throw Error(`batch ${batch.id}: ${batch.status} ${batch.failureReason}`);
 if(batch.totalRows!==part.rows)throw Error(`row count ${batch.totalRows} != ${part.rows}`);
 const item={file:part.file,batchId:batch.id,status:batch.status,totalRows:batch.totalRows,validRows:batch.importedRows,reviewRows:batch.totalRows-batch.importedRows};
 results.push(item);fs.writeFileSync(resultsFile,JSON.stringify(results,null,2));console.log(JSON.stringify(item));
}
console.log(JSON.stringify({completed:results.length,newRows:results.reduce((n,r)=>n+r.totalRows,0),validRows:results.reduce((n,r)=>n+r.validRows,0),existingSourceRows:manifest.overlap}));
