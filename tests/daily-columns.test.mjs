import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../app/RevenueTool.tsx", import.meta.url), "utf8");
const logic = source.slice(0, source.indexOf("async function parseWorkbook")).replace(/import .* from "react";/, "");
const context = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(logic + "\nglobalThis.parsers = {readDaily, mergeStores};"), context);
const { readDaily, mergeStores } = context.parsers;
const record = { 区域: "茂名区", 门店: "长岐化吴路店-MM012X", 应收金额: 2000,
  现金: 39.5, 微信: 1358.3, 支付宝: 0, 美团: 12, 美团收入: 999,
  饿了么: 13, 饿了么收入: 888, 京东: 14, 京东收入: 777,
  抖音团购: 333.28, 快手团购: 15, 本地外卖: 0, 美团团购r: 143 };
const rowsFor = (obj, headers = Object.keys(obj)) => [headers, headers.map(key => obj[key])];

test("daily amounts follow exact headers when columns move or Douyin is absent", () => {
  const normal = readDaily(rowsFor(record))[0];
  const reversed = readDaily(rowsFor(record, Object.keys(record).reverse()))[0];
  assert.deepEqual(reversed, normal);
  assert.equal(normal.metrics.其它外卖, 0);
  assert.equal(normal.metrics.美团团购, 143);
  assert.equal(normal.metrics.抖音外卖, 0);
  assert.equal(normal.metrics.美团外卖, 12);
  assert.equal(normal.metrics.饿了么, 13);
  assert.equal(normal.metrics.京东外卖, 14);
  assert.equal(normal.metrics.快手团购, 15);
  const added = readDaily(rowsFor({ 抖音外卖: 8.7, ...record }))[0];
  assert.equal(added.metrics.抖音外卖, 8.7);
  assert.equal(added.metrics.美团团购, 143);
});

test("other delivery uses cashier fallback, while daily Douyin zero stays authoritative", () => {
  const daily = readDaily(rowsFor(record));
  const cashier = { ...daily[0], source: "钉钉", metrics: { ...daily[0].metrics, 其它外卖: 263.5, 抖音外卖: 123 } };
  const result = mergeStores([cashier], daily).merged[0];
  assert.equal(result.metrics.其它外卖, 263.5);
  assert.equal(result.metrics.美团团购, 143);
  assert.equal(result.metrics.抖音外卖, 0);
});

test("unrecognized or ambiguous headers produce an error rather than wrong amounts", () => {
  assert.throws(() => readDaily([["错误文件"]]), /缺少/);
  assert.throws(() => readDaily([["门店", "应收金额", "门店"]]), /重复表头/);
});

test("Meituan group buying uses cashier through twice its amount and recalculates totals", () => {
  for (const [cashierAmount, dailyAmount, expected] of [
    [100, 150, 100], [100, 200, 100], [100, 200.01, 200.01],
    [100, 0, 100], [0, 143, 143], [0, 0, 0],
    [97.8, 143, 97.8], [97.8, 195.6, 97.8], [97.8, 195.61, 195.61],
  ]) {
    const daily = readDaily(rowsFor({ ...record, 美团团购r: dailyAmount }));
    const cashier = { ...daily[0], source: "钉钉", metrics: { ...daily[0].metrics, 美团团购: cashierAmount } };
    const result = mergeStores([cashier], daily).merged[0];
    assert.equal(result.metrics.美团团购, expected, `${cashierAmount} / ${dailyAmount}`);
    assert.ok(Math.abs(result.total - (daily[0].total - dailyAmount + expected)) < 0.000001);
    for (const key of Object.keys(result.metrics)) {
      if (key !== "美团团购") assert.equal(result.metrics[key], daily[0].metrics[key]);
    }
    assert.equal(daily[0].metrics.美团团购, dailyAmount);
  }
});
