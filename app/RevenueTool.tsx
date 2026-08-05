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

async function createOutput(stores: Store[], displayDate: string, filename: string) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "营业额统计网页版";
  const sheet = workbook.addWorksheet("营业额统计", { views: [{ showGridLines: false }] });
  const headers = ["选择区", "门店", "营业额", ...metricKeys];
  const yellow = "FFFFFF00";
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
        const fill = store.total < 2000 && column >= 2 ? yellow : baseFill;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.font = { name: "微软雅黑", size: 12, bold: column === 1, color: { argb: black } };
        cell.alignment = { horizontal: column === 2 ? "left" : "center", vertical: "middle" };
        cell.border = border;
        if (column >= 3) cell.numFmt = "#,##0.00";
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
    totalRow.getCell(column).numFmt = "#,##0.00";
  }
  styleRow(currentRow, yellow, true);
  sheet.getRow(currentRow).height = 25;
  currentRow += 1;

  [
    "标黄门店表示统计当日,营业额低于2000餐厅,便于关注！",
    "制表数据来自收银记录与店长钉钉上报,仅供参考,实收数据请以财务报表为准！",
  ].forEach((note) => {
    sheet.addRow([note]);
    sheet.mergeCells(currentRow, 1, currentRow, 14);
    styleRow(currentRow, yellow, true);
    sheet.getRow(currentRow).height = 25;
    currentRow += 1;
  });

  [8, 26, 11, 10, 11, 9, 10, 10, 10, 13, 13, 13, 11, 10].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
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

const formatAmount = (value: number) => value === 0
  ? ""
  : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

async function createHighResImage(stores: Store[], displayDate: string) {
  const grouped = new Map<string, Store[]>();
  stores.forEach((store) => grouped.set(store.region, [...(grouped.get(store.region) ?? []), store]));
  grouped.forEach((items) => items.sort((a, b) => b.total - a.total));
  const regions = [...regionOrder.filter((region) => grouped.has(region)), ...[...grouped.keys()].filter((region) => !regionOrder.includes(region))];

  const canvasWidth = 2400;
  const margin = 40;
  const titleHeight = 88;
  const headerHeight = 62;
  const rowHeight = 48;
  const totalHeight = 62;
  const noteHeight = 52;
  const footerHeight = 44;
  const canvasHeight = margin * 2 + titleHeight + headerHeight + stores.length * rowHeight + totalHeight + noteHeight * 2 + footerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成图片");

  context.fillStyle = "#F4F7FB";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  const baseWidths = [118, 330, 165, 135, 150, 135, 155, 135, 155, 175, 175, 175, 155, 142];
  const widthScale = (canvasWidth - margin * 2) / baseWidths.reduce((sum, width) => sum + width, 0);
  const widths = baseWidths.map((width) => width * widthScale);
  const starts: number[] = [];
  widths.reduce((x, width) => {
    starts.push(x);
    return x + width;
  }, margin);
  const headers = ["选择区", "门店", "营业额", ...metricKeys];
  const fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif';

  const fitText = (text: string, maxWidth: number) => {
    if (context.measureText(text).width <= maxWidth) return text;
    let result = text;
    while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
    return `${result}…`;
  };

  const drawCell = (
    column: number,
    y: number,
    height: number,
    text: string,
    options: { fill: string; bold?: boolean; align?: "left" | "center"; fontSize?: number; color?: string },
  ) => {
    const x = starts[column];
    const width = widths[column];
    context.fillStyle = options.fill;
    context.fillRect(x, y, width, height);
    context.strokeStyle = "#FFFFFF";
    context.lineWidth = 3;
    context.strokeRect(x, y, width, height);
    context.fillStyle = options.color ?? "#111827";
    context.font = `${options.bold ? "700" : "400"} ${options.fontSize ?? 22}px ${fontFamily}`;
    context.textBaseline = "middle";
    context.textAlign = options.align ?? "center";
    const padding = 12;
    const fitted = fitText(text, width - padding * 2);
    context.fillText(fitted, options.align === "left" ? x + padding : x + width / 2, y + height / 2 + 1);
  };

  let y = margin;
  context.fillStyle = "#FFFF00";
  context.fillRect(margin, y, canvasWidth - margin * 2, titleHeight);
  context.strokeStyle = "#FFFFFF";
  context.lineWidth = 3;
  context.strokeRect(margin, y, canvasWidth - margin * 2, titleHeight);
  context.fillStyle = "#0F172A";
  context.font = `700 38px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`${displayDate}营业额统计`, canvasWidth / 2, y + titleHeight / 2);
  y += titleHeight;

  headers.forEach((header, column) => drawCell(column, y, headerHeight, header, { fill: "#FFFF00", bold: true, fontSize: 21 }));
  y += headerHeight;

  regions.forEach((region, regionIndex) => {
    const items = grouped.get(region) ?? [];
    const baseFill = regionIndex % 2 === 0 ? "#FCE4D6" : "#E2F0D9";
    const regionY = y;
    items.forEach((store) => {
      drawCell(1, y, rowHeight, store.storeName, { fill: store.total < 2000 ? "#FFFF00" : baseFill, align: "left", fontSize: 20 });
      drawCell(2, y, rowHeight, formatAmount(store.total), { fill: store.total < 2000 ? "#FFFF00" : baseFill, fontSize: 19 });
      metricKeys.forEach((key, index) => drawCell(index + 3, y, rowHeight, formatAmount(store.metrics[key]), { fill: store.total < 2000 ? "#FFFF00" : baseFill, fontSize: 19 }));
      y += rowHeight;
    });
    drawCell(0, regionY, Math.max(rowHeight, items.length * rowHeight), region, { fill: baseFill, bold: true, fontSize: 21 });
  });

  const totals = emptyMetrics();
  stores.forEach((store) => metricKeys.forEach((key) => { totals[key] += store.metrics[key]; }));
  drawCell(0, y, totalHeight, "", { fill: "#FFFF00", bold: true });
  drawCell(1, y, totalHeight, "合计", { fill: "#FFFF00", bold: true, align: "left", fontSize: 22 });
  drawCell(2, y, totalHeight, formatAmount(calcTotal(totals)), { fill: "#FFFF00", bold: true, fontSize: 20 });
  metricKeys.forEach((key, index) => drawCell(index + 3, y, totalHeight, formatAmount(totals[key]), { fill: "#FFFF00", bold: true, fontSize: 20 }));
  y += totalHeight;

  [
    "标黄门店表示统计当日,营业额低于2000餐厅,便于关注！",
    "制表数据来自收银记录与店长钉钉上报,仅供参考,实收数据请以财务报表为准！",
  ].forEach((note) => {
    context.fillStyle = "#FFFF00";
    context.fillRect(margin, y, canvasWidth - margin * 2, noteHeight);
    context.strokeStyle = "#FFFFFF";
    context.lineWidth = 3;
    context.strokeRect(margin, y, canvasWidth - margin * 2, noteHeight);
    context.fillStyle = "#111827";
    context.font = `700 20px ${fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(note, canvasWidth / 2, y + noteHeight / 2);
    y += noteHeight;
  });

  context.fillStyle = "#64748B";
  context.font = `500 17px ${fontFamily}`;
  context.textAlign = "center";
  context.fillText(`营业额统计工具 · ${stores.length} 家门店 · ${regions.length} 个区域 · 高清长图`, canvasWidth / 2, y + footerHeight / 2);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("高清图片生成失败")), "image/png", 1);
  });
  return blob;
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
  const [imageResult, setImageResult] = useState<{ url: string; filename: string } | null>(null);
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
      const firstDate = dateText.trim() || dingding.find((store) => store.dateStr)?.dateStr || `${new Date().getMonth() + 1}月${new Date().getDate()}日`;
      const displayDate = displayDateFrom(firstDate);
      const safeDate = firstDate.replace(/[\\/:*?"<>|]/g, "-");
      addLog("[4/4] 正在生成统计结果…");
      if (outputMode === "excel" || outputMode === "both") {
        await createOutput(merged, displayDate, `${safeDate} 统计表.xlsx`);
        addLog("      Excel 统计表已下载");
      }
      if (outputMode === "image" || outputMode === "both") {
        const imageBlob = await createHighResImage(merged, displayDate);
        setImageResult({ url: URL.createObjectURL(imageBlob), filename: `${safeDate} 营业额统计高清图.png` });
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
            <div className="image-result-heading"><div><strong>高清长图预览</strong><small>2400px 宽 · PNG 格式</small></div><span>已生成</span></div>
            <div className="image-preview"><img src={imageResult.url} alt={`${dateText || "当日"}营业额统计高清长图`} /></div>
            <a className="save-image-button" href={imageResult.url} download={imageResult.filename}>保存高清图片</a>
            <p>iPhone 如未自动保存：长按上方图片，选择“存储到照片”。</p>
          </div>
        )}

        <div className="log-box" aria-live="polite">
          <div className="log-title"><span />运行日志</div>
          <pre>{logs.join("\n")}</pre>
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
