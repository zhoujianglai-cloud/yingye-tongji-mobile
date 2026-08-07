"use client";

import { ChangeEvent, useMemo, useState } from "react";

const metricKeys = [
  "现金", "微信", "支付宝", "美团外卖", "饿了么", "京东外卖",
  "美团团购", "抖音团购", "快手团购", "其它外卖", "其他收入",
] as const;

type MetricKey = (typeof metricKeys)[number];
type Metrics = Record<MetricKey, number>;

type Store = {
  region: string;
  storeName: string;
  storeId: string | null;
  source: "钉钉" | "日流水";
  dateStr: string;
  metrics: Metrics;
  total: number;
};

type OutputMode = "excel" | "image" | "both";

const abnormalThresholds = {
  营业额: 100000,
  美团外卖: 20000,
  饿了么: 20000,
  京东外卖: 5000,
  美团团购: 5000,
  抖音团购: 20000,
  快手团购: 5000,
  其它外卖: 2000,
  其他收入: 2000,
} as const;

type AbnormalMetric = keyof typeof abnormalThresholds;

const abnormalMetricLabels: Record<AbnormalMetric, string> = {
  营业额: "营业额",
  美团外卖: "美团外卖",
  饿了么: "饿了么",
  京东外卖: "京东",
  美团团购: "美团团购",
  抖音团购: "抖音团购",
  快手团购: "快手",
  其它外卖: "其它外卖",
  其他收入: "其它收入",
};

const regionOrder = [
  "福建区", "河源区", "雷州区", "梅州区", "茂名区",
  "南油区", "阳江区", "阳茂区", "湛江区", "肇庆区",
];

const emptyMetrics = (): Metrics => ({
  现金: 0, 微信: 0, 支付宝: 0, 美团外卖: 0, 饿了么: 0, 京东外卖: 0,
  美团团购: 0, 抖音团购: 0, 快手团购: 0, 其它外卖: 0, 其他收入: 0,
});

const toNum = (value: unknown) => {
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!text || text === "-" || text === "nan" || text === "None") return 0;
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const calcTotal = (metrics: Metrics) => metricKeys.reduce((sum, key) => sum + metrics[key], 0);

const extractStoreId = (value: unknown) => {
  const matched = String(value ?? "").match(/[A-Z]{2,3}\d{3}[A-Z]?/);
  return matched ? matched[0] : null;
};

const cleanStoreName = (value: unknown) => String(value ?? "")
  .trim()
  .replace(/\s*[-]?\s*[A-Z]{2,3}\d{3}[A-Z]?\s*$/, "")
  .replace(/[（(]停业[)）]/g, "")
  .replace(/\.$/, "")
  .trim();

const normalizeId = (id: string | null) => id?.replace(/X$/, "") ?? null;
const normalizeName = (name: string) => name.trim().replace(/店$/, "");

const formatSourceDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value ?? "").trim();
};

function readDingding(rows: unknown[][]): Store[] {
  const stores: Store[] = [];
  for (let r = 2; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    if (!String(row[0] ?? "").trim()) continue;
    const region = String(row[8] ?? "").trim();
    let storeField = "";
    for (let column = 9; column < 19; column += 1) {
      const candidate = String(row[column] ?? "").trim();
      if (candidate && candidate !== "-" && candidate !== "nan" && candidate !== "None") {
        storeField = candidate;
        break;
      }
    }
    if (!storeField) continue;
    const parts = storeField.split(/\s+/, 2);
    const storeName = parts.length === 2 ? parts[1].trim() : storeField;
    const metrics = emptyMetrics();
    metrics.现金 = toNum(row[21]);
    metrics.微信 = toNum(row[22]);
    metrics.支付宝 = toNum(row[23]);
    metrics.美团外卖 = toNum(row[24]);
    metrics.饿了么 = toNum(row[25]);
    metrics.京东外卖 = toNum(row[26]);
    metrics.美团团购 = toNum(row[27]);
    metrics.抖音团购 = toNum(row[28]);
    metrics.快手团购 = toNum(row[29]);
    metrics.其它外卖 = toNum(row[32]) + toNum(row[35]) + toNum(row[38]);
    metrics.其他收入 = toNum(row[41]) + toNum(row[44]) + toNum(row[47]) + toNum(row[50]);
    stores.push({
      region,
      storeName,
      storeId: extractStoreId(storeField),
      source: "钉钉",
      dateStr: formatSourceDate(row[19]),
      metrics,
      total: calcTotal(metrics),
    });
  }
  return stores;
}

function readDaily(rows: unknown[][]): Store[] {
  const stores: Store[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    if (row.length < 5 || !String(row[3] ?? "").trim()) continue;
    const region = String(row[1] ?? "").trim();
    if (region === "停业门店" || region === "Test" || toNum(row[4]) === 0) continue;
    const metrics = emptyMetrics();
    metrics.现金 = toNum(row[18]);
    metrics.微信 = toNum(row[21]);
    metrics.支付宝 = toNum(row[23]);
    metrics.美团外卖 = toNum(row[51]);
    metrics.饿了么 = toNum(row[49]);
    metrics.京东外卖 = toNum(row[55]);
    metrics.美团团购 = toNum(row[37]);
    metrics.抖音团购 = toNum(row[26]);
    metrics.快手团购 = toNum(row[29]);
    metrics.其它外卖 = toNum(row[36]);
    stores.push({
      region,
      storeName: cleanStoreName(row[3]),
      storeId: extractStoreId(row[3]),
      source: "日流水",
      dateStr: "",
      metrics,
      total: calcTotal(metrics),
    });
  }
  return stores;
}

function findMatch(store: Store, byId: Map<string, Store>, byName: Map<string, Store>) {
  const id = normalizeId(store.storeId);
  return (id ? byId.get(id) : undefined)
    ?? byName.get(store.storeName)
    ?? byName.get(normalizeName(store.storeName));
}

function mergeStores(dingding: Store[], daily: Store[]) {
  const dailyById = new Map<string, Store>();
  const dailyByName = new Map<string, Store>();
  daily.forEach((store) => {
    const id = normalizeId(store.storeId);
    if (id) dailyById.set(id, store);
    dailyByName.set(store.storeName, store);
    dailyByName.set(normalizeName(store.storeName), store);
  });

  const groups = new Map<string, Store[]>();
  dingding.forEach((store) => {
    const key = normalizeId(store.storeId) ?? `name:${store.storeName}`;
    groups.set(key, [...(groups.get(key) ?? []), store]);
  });
  const deduped: Store[] = [];
  groups.forEach((items) => {
    if (items.length === 1) {
      deduped.push(items[0]);
      return;
    }
    const dailyMatch = items.map((item) => findMatch(item, dailyById, dailyByName)).find(Boolean);
    const sorted = [...items].sort((a, b) => dailyMatch
      ? Math.abs(a.total - dailyMatch.total) - Math.abs(b.total - dailyMatch.total)
      : b.total - a.total);
    deduped.push(sorted[0]);
  });

  const merged = daily.map((store) => ({ ...store, metrics: { ...store.metrics } }));
  const mergedById = new Map<string, Store>();
  const mergedByName = new Map<string, Store>();
  merged.forEach((store) => {
    const id = normalizeId(store.storeId);
    if (id) mergedById.set(id, store);
    mergedByName.set(store.storeName, store);
    mergedByName.set(normalizeName(store.storeName), store);
  });
  const extras: Store[] = [];
  deduped.forEach((store) => {
    const matched = findMatch(store, mergedById, mergedByName);
    if (!matched) {
      extras.push(store);
      return;
    }
    metricKeys.forEach((key) => {
      if (matched.metrics[key] === 0 && store.metrics[key] !== 0) matched.metrics[key] = store.metrics[key];
    });
    matched.total = calcTotal(matched.metrics);
  });
  return { merged, extras, duplicateGroups: [...groups.values()].filter((items) => items.length > 1).length };
}

async function parseWorkbook(file: File) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
}

function displayDateFrom(rawDate: string) {
  const matched = rawDate.match(/(?:\d{4}-)?(\d{1,2})[-月](\d{1,2})/);
  if (matched) return `${Number(matched[1])}月${Number(matched[2])}日`;
  return rawDate;
}

const formatAmount = (value: number) => value === 0
  ? ""
  : new Intl.NumberFormat("zh-CN", { useGrouping: false, maximumFractionDigits: 2 }).format(value);

const formatLogAmount = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

function getAbnormalItems(store: Store) {
  return (Object.entries(abnormalThresholds) as [AbnormalMetric, number][])
    .filter(([key, threshold]) => (key === "营业额" ? store.total : store.metrics[key]) > threshold)
    .map(([key, threshold]) => ({
      key,
      label: abnormalMetricLabels[key],
      value: key === "营业额" ? store.total : store.metrics[key],
      threshold,
    }));
}

function isAbnormalCell(store: Store, column: number) {
  if (column === 3) return store.total > abnormalThresholds.营业额;
  const metric = metricKeys[column - 4];
  return Boolean(metric && metric in abnormalThresholds && store.metrics[metric] > abnormalThresholds[metric as keyof typeof abnormalThresholds]);
}

function calculateTotals(stores: Store[]) {
  const totals = emptyMetrics();
  stores.forEach((store) => metricKeys.forEach((key) => { totals[key] += store.metrics[key]; }));
  return totals;
}

function getColumnTexts(stores: Store[], totals: Metrics) {
  return [
    ["选择区", ...stores.map((store) => store.region)],
    ["门店", "合计", ...stores.map((store) => store.storeName)],
    ["营业额", formatAmount(calcTotal(totals)), ...stores.map((store) => formatAmount(store.total))],
    ...metricKeys.map((key) => [key, formatAmount(totals[key]), ...stores.map((store) => formatAmount(store.metrics[key]))]),
  ];
}

function excelTextUnits(text: string) {
  return Array.from(text).reduce((sum, character) => sum + (/[^\x00-\xff]/.test(character) ? 2 : 1), 0);
}

async function createOutput(stores: Store[], displayDate: string, filename: string) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "营业额统计网页版";
  const sheet = workbook.addWorksheet("营业额统计", { views: [{ showGridLines: false }] });
  const headers = ["选择区", "门店", "营业额", ...metricKeys];
  const yellow = "FFFFFF00";
  const alertRed = "FFE53935";
  const black = "FF000000";
  const white = "FFFFFFFF";
  const border = {
    top: { style: "medium" as const, color: { argb: white } },
    left: { style: "medium" as const, color: { argb: white } },
    bottom: { style: "medium" as const, color: { argb: white } },
    right: { style: "medium" as const, color: { argb: white } },
  };
  const styleRow = (rowNumber: number, fill: string, bold = false) => {
    for (let column = 1; column <= 14; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { name: "微软雅黑", size: 12, bold, color: { argb: black } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = border;
    }
  };

  sheet.mergeCells("A1:N1");
  sheet.getCell("A1").value = `${displayDate}营业额统计`;
  styleRow(1, yellow, true);
  sheet.getCell("A1").font = { name: "微软雅黑", size: 16, bold: true, color: { argb: black } };
  sheet.getRow(1).height = 30;
  sheet.addRow(headers);
  styleRow(2, yellow, true);
  sheet.getRow(2).height = 25;

  const grouped = new Map<string, Store[]>();
  stores.forEach((store) => grouped.set(store.region, [...(grouped.get(store.region) ?? []), store]));
  grouped.forEach((items) => items.sort((a, b) => b.total - a.total));
  const regions = [...regionOrder.filter((region) => grouped.has(region)), ...[...grouped.keys()].filter((region) => !regionOrder.includes(region))];
  let currentRow = 3;
  regions.forEach((region, regionIndex) => {
    const items = grouped.get(region) ?? [];
    const start = currentRow;
    items.forEach((store) => {
      sheet.addRow([store.region, store.storeName, store.total, ...metricKeys.map((key) => store.metrics[key] || null)]);
      const baseFill = regionIndex % 2 === 0 ? "FFFCE4D6" : "FFE2F0D9";
      for (let column = 1; column <= 14; column += 1) {
        const cell = sheet.getCell(currentRow, column);
        const abnormal = isAbnormalCell(store, column);
        const fill = abnormal ? alertRed : store.total < 2000 && column >= 2 ? yellow : baseFill;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.font = { name: "微软雅黑", size: 12, bold: column === 1 || abnormal, color: { argb: abnormal ? white : black } };
        cell.alignment = { horizontal: column === 2 ? "left" : "center", vertical: "middle" };
        cell.border = border;
        if (column >= 3) cell.numFmt = "0.00";
      }
      sheet.getRow(currentRow).height = 18;
      currentRow += 1;
    });
    if (currentRow - 1 > start) sheet.mergeCells(start, 1, currentRow - 1, 1);
  });

  const dataEnd = currentRow - 1;
  const totalRow = sheet.addRow([null, "合计"]);
  for (let column = 3; column <= 14; column += 1) {
    const letter = sheet.getColumn(column).letter;
    totalRow.getCell(column).value = { formula: `SUM(${letter}3:${letter}${dataEnd})` };
    totalRow.getCell(column).numFmt = "0.00";
  }
  styleRow(currentRow, yellow, true);
  sheet.getRow(currentRow).height = 25;
  currentRow += 1;

  [
    "标黄门店表示统计当日,营业额低于2000餐厅,便于关注！",
    "标红单元格表示该项金额超过异常阈值,请及时核对！",
    "制表数据来自收银记录与店长钉钉上报,仅供参考,实收数据请以财务报表为准！",
  ].forEach((note) => {
    sheet.addRow([note]);
    sheet.mergeCells(currentRow, 1, currentRow, 14);
    styleRow(currentRow, yellow, true);
    sheet.getRow(currentRow).height = 25;
    currentRow += 1;
  });

  const totals = calculateTotals(stores);
  const columnTexts = getColumnTexts(stores, totals);
  const minimumWidths = [8, 12, 12, 10, 12, 10, 12, 12, 12, 12, 12, 10, 12, 10];
  columnTexts.forEach((texts, index) => {
    const contentWidth = Math.max(...texts.map(excelTextUnits)) + 2;
    sheet.getColumn(index + 1).width = Math.max(minimumWidths[index], contentWidth);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pngCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function setPngDpi(blob: Blob, dpi: number) {
  const png = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || !signature.every((byte, index) => png[index] === byte)) return blob;

  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const physicalChunk = new Uint8Array(21);
  const physicalView = new DataView(physicalChunk.buffer);
  physicalView.setUint32(0, 9);
  physicalChunk.set([112, 72, 89, 115], 4); // pHYs
  physicalView.setUint32(8, pixelsPerMeter);
  physicalView.setUint32(12, pixelsPerMeter);
  physicalChunk[16] = 1;
  physicalView.setUint32(17, pngCrc32(physicalChunk.subarray(4, 17)));

  const chunks: Uint8Array[] = [png.slice(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > png.length) return blob;
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type !== "pHYs") chunks.push(png.slice(offset, end));
    if (type === "IHDR" && !inserted) {
      chunks.push(physicalChunk);
      inserted = true;
    }
    offset = end;
  }
  if (!inserted) return blob;

  const outputLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(outputLength);
  let outputOffset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, outputOffset);
    outputOffset += chunk.length;
  });
  return new Blob([output], { type: "image/png" });
}

async function createHighResImage(stores: Store[], displayDate: string) {
  const grouped = new Map<string, Store[]>();
  stores.forEach((store) => grouped.set(store.region, [...(grouped.get(store.region) ?? []), store]));
  grouped.forEach((items) => items.sort((a, b) => b.total - a.total));
  const regions = [...regionOrder.filter((region) => grouped.has(region)), ...[...grouped.keys()].filter((region) => !regionOrder.includes(region))];

  // 与参考图保持完全一致的像素尺寸，并在 PNG 中写入 600 DPI 元数据。
  const canvasWidth = 2698;
  const canvasHeight = 6418;
  const outputDpi = 600;
  const grid = 4;
  const titleHeight = 80;
  const headerHeight = 60;
  const totalHeight = 60;
  const noteHeight = 60;
  const noteCount = 3;
  const fontFamily = '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif';
  const totals = calculateTotals(stores);
  const columnTexts = getColumnTexts(stores, totals);
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成图片");

  const sectionGaps = grid * (noteCount + 3);
  const rowGaps = grid * Math.max(stores.length - 1, 0);
  const rowPixels = canvasHeight
    - titleHeight
    - headerHeight
    - totalHeight
    - noteHeight * noteCount
    - sectionGaps
    - rowGaps;
  if (rowPixels < stores.length * 16) throw new Error("门店数量过多，无法在参考图尺寸内清晰排版");
  const baseRowHeight = Math.floor(rowPixels / Math.max(stores.length, 1));
  const extraRowPixels = rowPixels - baseRowHeight * stores.length;
  const rowHeights = stores.map((_, index) => baseRowHeight + (index < extraRowPixels ? 1 : 0));
  const shortestRow = rowHeights.length ? Math.min(...rowHeights) : baseRowHeight;
  const bodyFontPx = Math.max(22, Math.min(32, shortestRow - 8));
  const titleFontPx = 42;

  // 先按最长内容测量列宽，再等比铺满固定宽度，所有列线都落在整数像素上。
  context.font = `700 ${bodyFontPx}px ${fontFamily}`;
  const minimumWidths = [88, 282, 146, 130, 146, 114, 130, 130, 130, 130, 130, 112, 130, 112];
  const desiredWidths = columnTexts.map((texts, index) => {
    const measured = Math.max(...texts.map((text) => context.measureText(text).width));
    return Math.max(minimumWidths[index], Math.ceil(measured + 28));
  });
  const availableWidth = canvasWidth - grid * (desiredWidths.length - 1);
  const widthScale = availableWidth / desiredWidths.reduce((sum, width) => sum + width, 0);
  const widths = desiredWidths.map((width) => Math.floor(width * widthScale));
  widths[widths.length - 1] += availableWidth - widths.reduce((sum, width) => sum + width, 0);
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const starts: number[] = [];
  widths.reduce((x, width) => {
    starts.push(x);
    return x + width + grid;
  }, 0);
  const headers = ["选择区", "门店", "营业额", ...metricKeys];

  const setFittedFont = (text: string, maxWidth: number, preferredPx: number, bold: boolean) => {
    let fontPx = preferredPx;
    context.font = `${bold ? "700" : "400"} ${fontPx}px ${fontFamily}`;
    while (fontPx > 18 && context.measureText(text).width > maxWidth) {
      fontPx -= 1;
      context.font = `${bold ? "700" : "400"} ${fontPx}px ${fontFamily}`;
    }
    return fontPx;
  };

  const glyphCenteredBaseline = (text: string, y: number, height: number, fontPx: number) => {
    const metrics = context.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.78;
    const descent = metrics.actualBoundingBoxDescent || fontPx * 0.22;
    return Math.round(y + height / 2 + (ascent - descent) / 2);
  };

  const drawCell = (
    column: number,
    y: number,
    height: number,
    text: string,
    options: { fill: string; bold?: boolean; align?: "left" | "center"; fontPx?: number; color?: string },
  ) => {
    const x = starts[column];
    const width = widths[column];
    context.fillStyle = options.fill;
    context.fillRect(x, y, width, height);
    context.fillStyle = options.color ?? "#000000";
    const padding = 12;
    const fontPx = setFittedFont(text, width - padding * 2, Math.min(options.fontPx ?? bodyFontPx, height - 8), Boolean(options.bold));
    context.textBaseline = "alphabetic";
    context.textAlign = options.align ?? "center";
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.fillText(
      text,
      options.align === "left" ? x + padding : Math.round(x + width / 2),
      glyphCenteredBaseline(text, y, height, fontPx),
    );
    context.restore();
  };

  let y = 0;
  context.fillStyle = "#FFFF00";
  context.fillRect(0, y, canvasWidth, titleHeight);
  context.fillStyle = "#000000";
  context.font = `700 ${titleFontPx}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  const title = `${displayDate}营业额统计`;
  context.fillText(title, canvasWidth / 2, glyphCenteredBaseline(title, y, titleHeight, titleFontPx));
  y += titleHeight + grid;

  headers.forEach((header, column) => drawCell(column, y, headerHeight, header, { fill: "#FFFF00", bold: true }));
  y += headerHeight + grid;

  let rowIndex = 0;
  regions.forEach((region, regionIndex) => {
    const items = grouped.get(region) ?? [];
    const baseFill = regionIndex % 2 === 0 ? "#FCE4D6" : "#E2F0D9";
    const regionY = y;
    let regionHeight = 0;
    items.forEach((store, itemIndex) => {
      const rowHeight = rowHeights[rowIndex] ?? baseRowHeight;
      const lowRevenueFill = store.total < 2000 ? "#FFFF00" : baseFill;
      drawCell(1, y, rowHeight, store.storeName, { fill: lowRevenueFill, align: "left" });
      drawCell(2, y, rowHeight, formatAmount(store.total), {
        fill: store.total > abnormalThresholds.营业额 ? "#E53935" : lowRevenueFill,
        bold: store.total > abnormalThresholds.营业额,
        color: store.total > abnormalThresholds.营业额 ? "#FFFFFF" : undefined,
      });
      metricKeys.forEach((key, index) => {
        const threshold = key in abnormalThresholds ? abnormalThresholds[key as keyof typeof abnormalThresholds] : null;
        const abnormal = threshold !== null && store.metrics[key] > threshold;
        drawCell(index + 3, y, rowHeight, formatAmount(store.metrics[key]), {
          fill: abnormal ? "#E53935" : lowRevenueFill,
          bold: abnormal,
          color: abnormal ? "#FFFFFF" : undefined,
        });
      });
      regionHeight += rowHeight;
      if (itemIndex < items.length - 1) regionHeight += grid;
      rowIndex += 1;
      if (rowIndex < stores.length) {
        y += rowHeight + grid;
      } else {
        y += rowHeight;
      }
    });
    drawCell(0, regionY, Math.max(baseRowHeight, regionHeight), region, { fill: baseFill, bold: true });
  });

  y += grid;

  drawCell(0, y, totalHeight, "", { fill: "#FFFF00", bold: true });
  drawCell(1, y, totalHeight, "合计", { fill: "#FFFF00", bold: true });
  drawCell(2, y, totalHeight, formatAmount(calcTotal(totals)), { fill: "#FFFF00", bold: true });
  metricKeys.forEach((key, index) => drawCell(index + 3, y, totalHeight, formatAmount(totals[key]), { fill: "#FFFF00", bold: true }));
  y += totalHeight + grid;

  [
    "标黄门店表示统计当日,营业额低于2000餐厅,便于关注！",
    "标红单元格表示该项金额超过异常阈值,请及时核对！",
    "制表数据来自收银记录与店长钉钉上报,仅供参考,实收数据请以财务报表为准！",
  ].forEach((note, index) => {
    context.fillStyle = "#FFFF00";
    context.fillRect(0, y, canvasWidth, noteHeight);
    context.fillStyle = "#000000";
    const noteFontPx = setFittedFont(note, canvasWidth - 40, bodyFontPx, true);
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(note, canvasWidth / 2, glyphCenteredBaseline(note, y, noteHeight, noteFontPx));
    y += noteHeight + (index < noteCount - 1 ? grid : 0);
  });

  const canvasBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("高清图片生成失败")), "image/png", 1);
  });
  const blob = await setPngDpi(canvasBlob, outputDpi);
  return { blob, width: canvasWidth, height: canvasHeight };
}

function FilePicker({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  const id = `file-${label}`;
  return (
    <label className={`file-card ${file ? "has-file" : ""}`} htmlFor={id}>
      <input id={id} type="file" accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.files?.[0] ?? null)} />
      <span className="file-icon" aria-hidden="true">{file ? "✓" : "+"}</span>
      <span className="file-copy">
        <strong>{label}</strong>
        <small>{file ? file.name : "点击选择 Excel 文件"}</small>
      </span>
      <span className="file-action">{file ? "更换" : "选择"}</span>
    </label>
  );
}

export function RevenueTool() {
  const [dingdingFile, setDingdingFile] = useState<File | null>(null);
  const [dailyFile, setDailyFile] = useState<File | null>(null);
  const [dateText, setDateText] = useState("");
  const [logs, setLogs] = useState<string[]>(["请选择两个 Excel 文件开始处理"]);
  const [outputMode, setOutputMode] = useState<OutputMode>("excel");
  const [working, setWorking] = useState(false);
  const [completed, setCompleted] = useState<{ stores: number; regions: number } | null>(null);
  const [imageResult, setImageResult] = useState<{ url: string; filename: string; width: number; height: number } | null>(null);
  const ready = useMemo(() => Boolean(dingdingFile && dailyFile && !working), [dingdingFile, dailyFile, working]);

  const run = async () => {
    if (!dingdingFile || !dailyFile) return;
    setWorking(true);
    setCompleted(null);
    if (imageResult) URL.revokeObjectURL(imageResult.url);
    setImageResult(null);
    const nextLogs: string[] = [];
    const addLog = (message: string) => {
      nextLogs.push(message);
      setLogs([...nextLogs]);
    };
    try {
      addLog("[1/4] 正在读取钉钉记录…");
      const dingding = readDingding(await parseWorkbook(dingdingFile));
      addLog(`      已识别 ${dingding.length} 家门店`);
      addLog("[2/4] 正在读取日流水…");
      const daily = readDaily(await parseWorkbook(dailyFile));
      addLog(`      已识别 ${daily.length} 家门店`);
      addLog("[3/4] 正在匹配、去重和补充数据…");
      const { merged, extras, duplicateGroups } = mergeStores(dingding, daily);
      if (duplicateGroups) addLog(`      钉钉发现 ${duplicateGroups} 组重复门店，已自动去重`);
      if (extras.length) addLog(`      ${extras.length} 家门店仅存在于钉钉，未写入统计表`);
      const abnormalStores = merged
        .map((store) => ({ store, items: getAbnormalItems(store) }))
        .filter(({ items }) => items.length > 0);
      if (abnormalStores.length) {
        const abnormalCount = abnormalStores.reduce((sum, item) => sum + item.items.length, 0);
        addLog(`[异常提醒] 发现 ${abnormalStores.length} 家门店、${abnormalCount} 项金额超过阈值`);
        abnormalStores.forEach(({ store, items }) => {
          addLog(`[异常提醒] ${store.storeName}：${items.map((item) => `${item.label} ${formatLogAmount(item.value)}（阈值 ${formatLogAmount(item.threshold)}）`).join("；")}`);
        });
      } else {
        addLog("      异常检查通过，未发现超阈值项目");
      }
      const firstDate = dateText.trim() || dingding.find((store) => store.dateStr)?.dateStr || `${new Date().getMonth() + 1}月${new Date().getDate()}日`;
      const displayDate = displayDateFrom(firstDate);
      const safeDate = firstDate.replace(/[\\/:*?"<>|]/g, "-");
      addLog("[4/4] 正在生成统计结果…");
      if (outputMode === "excel" || outputMode === "both") {
        await createOutput(merged, displayDate, `${safeDate} 统计表.xlsx`);
        addLog("      Excel 统计表已下载");
      }
      if (outputMode === "image" || outputMode === "both") {
        const image = await createHighResImage(merged, displayDate);
        setImageResult({
          url: URL.createObjectURL(image.blob),
          filename: `${safeDate} 营业额统计高清图.png`,
          width: image.width,
          height: image.height,
        });
        addLog("      高清长图已生成，请点击保存图片");
      }
      const regionCount = new Set(merged.map((store) => store.region)).size;
      addLog(`完成！共 ${merged.length} 家门店，${regionCount} 个区域`);
      setCompleted({ stores: merged.length, regions: regionCount });
    } catch (error) {
      addLog(`处理失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWorking(false);
    }
  };

  return (
    <main>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="hero">
        <div className="brand-mark" aria-hidden="true"><span /><span /></div>
        <p className="eyebrow">手机端 · 本地处理</p>
        <h1>营业额统计</h1>
        <p className="subtitle">合并钉钉记录与日流水，一键生成标准统计表</p>
        <div className="privacy-pill"><span>●</span> 文件不会上传服务器</div>
      </section>

      <section className="tool-panel">
        <div className="step-heading"><span>1</span><div><h2>选择数据文件</h2><p>支持 Excel .xlsx 和 .xls 格式</p></div></div>
        <div className="file-grid">
          <FilePicker label="钉钉记录" file={dingdingFile} onChange={setDingdingFile} />
          <FilePicker label="日流水表" file={dailyFile} onChange={setDailyFile} />
        </div>

        <div className="date-field">
          <label htmlFor="stat-date">统计日期 <small>选填</small></label>
          <input id="stat-date" value={dateText} onChange={(event) => setDateText(event.target.value)} placeholder="例如：8月5日（留空自动提取）" />
        </div>

        <fieldset className="output-field">
          <legend>输出格式</legend>
          <div className="output-options">
            {([
              ["excel", "Excel 表格", "便于编辑"],
              ["image", "高清图片", "便于保存分享"],
              ["both", "两者都要", "表格 + 图片"],
            ] as const).map(([value, title, hint]) => (
              <label key={value} className={outputMode === value ? "selected" : ""}>
                <input type="radio" name="output-mode" value={value} checked={outputMode === value} onChange={() => setOutputMode(value)} />
                <span><strong>{title}</strong><small>{hint}</small></span>
                <i aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>

        <button className="generate-button" disabled={!ready} onClick={run}>
          {working
            ? <><span className="spinner" />正在生成统计结果…</>
            : outputMode === "excel" ? "生成并下载 Excel" : outputMode === "image" ? "生成高清图片" : "生成 Excel 和高清图片"}
        </button>

        {completed && <div className="success-banner"><span>✓</span><div><strong>统计表已生成</strong><small>{completed.stores} 家门店 · {completed.regions} 个区域</small></div></div>}

        {imageResult && (
          <div className="image-result">
            <div className="image-result-heading"><div><strong>高清长图预览</strong><small>{imageResult.width} × {imageResult.height} · 600 DPI · 字体垂直居中 · PNG</small></div><span>已生成</span></div>
            <div className="image-preview"><img src={imageResult.url} alt={`${dateText || "当日"}营业额统计高清长图`} /></div>
            <a className="save-image-button" href={imageResult.url} download={imageResult.filename}>保存高清图片</a>
            <p>iPhone 如未自动保存：长按上方图片，选择“存储到照片”。</p>
          </div>
        )}

        <div className="log-box" aria-live="polite">
          <div className="log-title"><span />运行日志</div>
          <pre>{logs.map((line, index) => <span className={`log-line ${line.startsWith("[异常提醒]") ? "alert" : ""}`} key={`${index}-${line}`}>{line}{index < logs.length - 1 ? "\n" : ""}</span>)}</pre>
        </div>
      </section>

      <section className="how-it-works">
        <h2>三步完成</h2>
        <div className="flow">
          <div><b>01</b><strong>选择文件</strong><span>从手机“文件”中选择</span></div>
          <i>→</i>
          <div><b>02</b><strong>自动合并</strong><span>匹配、去重并补零</span></div>
          <i>→</i>
          <div><b>03</b><strong>下载结果</strong><span>保存到手机或分享</span></div>
        </div>
      </section>

      <footer>营业额统计工具 · 所有数据仅在当前设备处理</footer>
    </main>
  );
}
