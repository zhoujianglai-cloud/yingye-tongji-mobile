import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the revenue tool", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>营业额统计工具<\/title>/);
  assert.match(html, /两份流水/);
  assert.match(html, /一键合并/);
  assert.match(html, /钉钉记录/);
  assert.match(html, /日流水表/);
  assert.match(html, /两者都要/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("keeps the iPhone image export within safe limits", async () => {
  const source = await readFile(new URL("../app/RevenueTool.tsx", import.meta.url), "utf8");

  assert.match(source, /const canvasWidth = appleMobile \? 2048 : 2698/);
  assert.match(source, /const canvasHeight = appleMobile \? 4096 : 6418/);
  assert.match(source, /if \(!appleMobile\)/);
  assert.match(source, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/);
  assert.match(source, /if \(!isAppleMobileDevice\(\)\) \{\s*downloadBlob\(imageResult\.blob, imageResult\.filename\);\s*return;/);
  assert.match(source, /系统菜单选择“存储图像”/);
  assert.doesNotMatch(source, /长按上方图片/);
  assert.match(source, /其它外卖: 2000/);
  assert.match(source, /key === "其它外卖" && store\.storeName === "阳西溪头店"/);
  assert.match(source, /return 5000/);
  assert.match(source, /function extractDateFromCashierFilename/);
  assert.match(source, /readDingding\(await parseWorkbook\(file\)\)\.find/);
  assert.match(source, /统计日期 <small>自动填写，可修改<\/small>/);
  assert.match(source, /dateStr: formatSourceDate\(row\[4\]\)/);
  assert.doesNotMatch(source, /dateStr: formatSourceDate\(row\[19\]\)/);
  assert.match(source, /"京东外卖",\s*"抖音外卖",\s*"美团团购"/);
  assert.match(source, /String\(cell \?\? ""\)\.trim\(\) === "抖音外卖"/);
  assert.match(source, /metrics\.抖音外卖 = hasDouyinDelivery \? toNum\(row\[27\]\) : 0/);
  assert.match(source, /metrics\.抖音外卖 = toNum\(row\[28\]\)/);
  assert.match(source, /if \(key === "抖音外卖"\) return;/);
  const abnormalThresholdBlock = source.match(/const abnormalThresholds = \{([\s\S]*?)\} as const;/)?.[1] ?? "";
  assert.match(abnormalThresholdBlock, /抖音外卖:\s*2000/);
  assert.match(source, /抖音外卖:\s*"抖音外卖"/);
  assert.match(source, /const outputColumnCount = headers\.length/);
});
