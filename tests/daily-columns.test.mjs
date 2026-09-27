import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../app/RevenueTool.tsx", import.meta.url), "utf8");
const logic = source.slice(0, source.indexOf("async function parseWorkbook")).replace(/import .* from "react";/, "");
const context = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(logic + "\nglobalThis.parsers = {readDingding, readDaily, mergeStores, inspectDailyHeaders, dailyHeaderBaseline};"), context);
const { readDingding, readDaily, mergeStores, inspectDailyHeaders, dailyHeaderBaseline } = context.parsers;
const record = { 区域: "茂名区", 门店: "长岐化吴路店-MM012X", 应收金额: 2000,
  现金: 39.5, 微信: 1358.3, 支付宝: 0, 美团: 12, 美团收入: 999,
  饿了么: 13, 饿了么收入: 888, 京东: 14, 京东收入: 777,
  抖音团购: 333.28, 快手团购: 15, 本地外卖: 0, 美团团购r: 143 };
const rowsFor = (obj, headers = Object.keys(obj)) => [headers, headers.map(key => obj[key])];

test("only renamed or deleted first-row headers need confirmation, including non-money columns", () => {
  assert.equal(inspectDailyHeaders([dailyHeaderBaseline, [123]]).length, 0);
  assert.equal(inspectDailyHeaders([[...dailyHeaderBaseline].reverse()]).length, 0);
  assert.equal(inspectDailyHeaders([[...dailyHeaderBaseline, "新列"]]).length, 0);
  assert.match(inspectDailyHeaders([dailyHeaderBaseline.filter(h => h !== "桌台数")]).join("\n"), /桌台数/);
  const renamed = inspectDailyHeaders([dailyHeaderBaseline.map(h => h === "均单消费" ? "客均消费" : h)]).join("\n");
  assert.match(renamed, /均单消费/); assert.match(renamed, /客均消费/);
});

test("cashier old and new delivery names read the same amounts", () => {
  for (const names of [["美团", "饿了么", "京东"], ["美团外卖", "淘宝闪购", "京东外卖"]]) {
    const header = []; header.splice(24, 0); header[24]=names[0]; header[25]=names[1]; header[26]=names[2];
    const row=[];row[0]=1;row[9]="MM012X 测试店";row[24]=12;row[25]=13;row[26]=14;
    const store=readDingding([["标题"],header,row])[0];
    assert.equal(store.metrics.美团外卖,12);assert.equal(store.metrics.淘宝闪购,13);assert.equal(store.metrics.京东外卖,14);
  }
});

test("empty cashier and daily input blocks output, while explicit zero cashier records remain valid", () => {
  for (const rows of [[], [[]], [["标题"], ["表头"]]]) assert.throws(() => readDingding(rows), /收银记录表内容为空/);
  const row = []; row[0] = "1"; row[9] = "MM012X 长岐化吴路店"; row[21] = 0;
  assert.equal(readDingding([[], [], row]).length, 1);
  assert.throws(() => readDaily([Object.keys(record)]), /没有可统计/);
});

test("new delivery headers read amounts instead of income without prompting for approved aliases", () => {
  const { 美团, 饿了么, 京东, ...rest } = record;
  const notices = [];
  const stores = readDaily(rowsFor({ ...rest, 美团外卖: 美团, 淘宝闪购: 饿了么, 京东外卖: 京东, 淘宝闪购收入: 9999 }), notices);
  assert.equal(stores[0].metrics.美团外卖, 12);
  assert.equal(stores[0].metrics.淘宝闪购, 13);
  assert.equal(stores[0].metrics.京东外卖, 14);
  assert.equal(notices.filter(line => line.startsWith("表头变化")).length, 0);
  assert.throws(() => readDaily(rowsFor({ ...record, 美团外卖: 500 })), /多个表头/);
});

test("review lists every changed amount and preserves original daily values", () => {
  const daily = readDaily(rowsFor(record));
  const cashier = { ...daily[0], metrics: { ...daily[0].metrics, 美团团购: 97.8, 其它外卖: 263.5 } };
  const { changes, merged } = mergeStores([cashier], daily);
  assert.equal(changes.length, 2);
  assert.match(changes.join("\n"), /143 → 97.8/);
  assert.match(changes.join("\n"), /0 → 263.5/);
  assert.equal(daily[0].metrics.其它外卖, 0);
  assert.equal(merged[0].metrics.其它外卖, 263.5);
  assert.equal(mergeStores(daily, daily).changes.length, 0);
});

test("Douyin delivery accepts either exact header without counting income or doubling amounts", () => {
  for (const [extra, expected] of [
    [{ 抖音: 42.43, 抖音收入: 35.59 }, 42.43],
    [{ 抖音外卖: 42.43, 抖音收入: 35.59 }, 42.43],
    [{ 抖音: 42.43, 抖音外卖: 12 }, 12],
    [{ 抖音: 42.43, 抖音外卖: 0 }, 0],
    [{ 抖音收入: 35.59 }, 0],
    [{ 抖音: 2000.01 }, 2000.01],
  ]) {
    const data = { ...record, ...extra };
    const daily = readDaily(rowsFor(data, Object.keys(data).reverse()));
    assert.equal(daily[0].metrics.抖音外卖, expected);
    const cashier = { ...daily[0], metrics: { ...daily[0].metrics, 抖音外卖: 999 } };
    assert.equal(mergeStores([cashier], daily).merged[0].metrics.抖音外卖, expected);
  }
});

test("daily amounts follow exact headers when columns move or Douyin is absent", () => {
  const normal = readDaily(rowsFor(record))[0];
  const reversed = readDaily(rowsFor(record, Object.keys(record).reverse()))[0];
  assert.deepEqual(reversed, normal);
  assert.equal(normal.metrics.其它外卖, 0);
  assert.equal(normal.metrics.美团团购, 143);
  assert.equal(normal.metrics.抖音外卖, 0);
  assert.equal(normal.metrics.美团外卖, 12);
  assert.equal(normal.metrics.淘宝闪购, 13);
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
