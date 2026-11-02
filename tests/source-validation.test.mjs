import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('../app/RevenueTool.tsx', import.meta.url), 'utf8');
const logic = source.slice(0, source.indexOf('async function parseWorkbook')).replace(/import .* from "react";/, '');
const ctx = vm.createContext({Date});
vm.runInContext(stripTypeScriptTypes(logic + '\nglobalThis.api={validateSourceData,readDaily,readDingding};'),ctx);
const {validateSourceData:check,readDaily,readDingding}=ctx.api;
const store=(i,amount=1000)=>({storeId:`MM${String(i).padStart(3,'0')}`,storeName:`门店${i}`,dateStr:'2026-10-31',metrics:{微信:amount},businessDates:[]});
const batch=(n=10)=>Array.from({length:n},(_,i)=>store(i));
const rejected=(fn,pattern)=>assert.throws(fn,e=>e.message==='表格数据有问题 请检查'&&pattern.test(e.details.join('\n')));
test('80 percent inclusive passes; below 80 fails even with a small overall difference',()=>{
 const d=batch();const c=batch();c[0].metrics.微信=980;c[1].metrics.微信=980;
 assert.equal(check(c,d).consistent,8);
 c[2].metrics.微信=980;rejected(()=>check(c,d),/不足 80%/);
});
test('single-store 1 percent boundary is strict; sub-cent precision retained',()=>{
 rejected(()=>check([store(1,990)],[store(1,1000)]),/不足 80%/);
 assert.equal(check([store(1,990.001)],[store(1,1000)]).consistent,1);
 assert.equal(check([store(1,3161.529)],[store(1,3161.52)]).consistent,1);
 const d=batch(),c=batch();c[0].metrics.微信=900;
 assert.equal(check(c,d).consistent,9);
 c[0].metrics.微信=900.001;assert.equal(check(c,d).consistent,9);
});
test('large overall differences pass at 80 percent; zero and missing/invalid values are handled',()=>{
 const d=batch(),c=batch();c[0].metrics.微信=0;c[1].metrics.微信=1000000;
 assert.equal(check(c,d).consistent,8);
 c[2].metrics.微信=0;rejected(()=>check(c,d),/不足 80%/);
 assert.equal(check([store(1,0)],[store(1,0)]).consistent,1);
 rejected(()=>check([store(1,0)],[store(1,1)]),/不足/);
 rejected(()=>check([{...store(1,0),wechatValid:false}],[store(1,0)]),/微信金额为空/);
 assert.equal(check(batch(8),batch()).consistent,8);
 rejected(()=>check(batch(7),batch()),/不足 80%/);
});
test('mixed, missing and invalid dates never block a passing amount match',()=>{
 const d=batch(),c=batch();c[0].dateStr='2026-11-01';c[1].dateStr='';c[2].dateStr='2026-02-30';
 d[0].businessDates=['2025-10-31'];assert.equal(check(c,d).consistent,10);
});
test('duplicate conflicts and mismatched IDs count as inconsistent without an independent block',()=>{
 const d=batch(),c=batch();c.push(store(0,100));assert.equal(check(c,d).consistent,9);
 c.pop();c[0].storeId='MM999';assert.equal(check(c,d).consistent,9);
 c[1].storeId='MM998';assert.equal(check(c,d).consistent,8);
 c[2].storeId='MM997';rejected(()=>check(c,d),/不足 80%/);
});
test('parsers preserve raw precision, date metadata and invalid amount flags',()=>{
 const d=readDaily([['门店','应收金额','微信','营业日期'],['测试-MM001',100,3161.52,'2026-10-31']]);
 const h=[];h[4]='填写周期';h[19]='日期';const r=[];r[0]='已提交';r[4]='2026-10-31';r[9]='MM001 测试';r[19]='2026-10-31';r[22]='3161.529';
 const c=readDingding([h,[],r]);assert.equal(check(c,d).consistent,1);
 r[22]='-';rejected(()=>check(readDingding([h,[],r]),d),/微信金额为空/);
});
