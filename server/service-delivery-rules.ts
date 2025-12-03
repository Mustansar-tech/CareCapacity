import * as XLSX from "xlsx";

/** Column synonyms so we can map by name, not position */
const SERVICE_COL_SYNONYMS = {
  serviceType: [
    "Planned Service Type Description",
    "Service Type Description",
    "Service Type",
    "Actual Service Type Description", // fallback if planned missing
  ],
  weekday: [
    "Planned Start Date Weekday",
    "Start Date Weekday",
    "Weekday",
  ],
  duration: [
    "Planned Duration",
    "Duration (Planned)",
    "Duration",
    "Planned Hrs",
    "Planned Hours",
    "Planned Time",
  ],
  cancellation: [
    "Cancellation Description",
    "Cancelled Reason",
    "Cancellation",
  ],
} as const;

type LogicalKey = keyof typeof SERVICE_COL_SYNONYMS;

type CleanRow = {
  serviceType: string;
  weekday: string;
  duration: number;
  cancellation: string | null;
};

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchOne(headers: string[], synonyms: readonly string[]): string | null {
  // exact normalized
  for (const h of headers) {
    for (const syn of synonyms) {
      if (norm(h) === norm(syn)) return h;
    }
  }
  // soft contains/startswith either way
  for (const h of headers) {
    const nh = norm(h);
    for (const syn of synonyms) {
      const ns = norm(syn);
      if (nh.includes(ns) || ns.includes(nh)) return h;
    }
  }
  return null;
}

function pickBestSheet(wb: XLSX.WorkBook): XLSX.WorkSheet {
  const names = wb.SheetNames;
  const exact = names.find((n) => n === "Data");
  if (exact) return wb.Sheets[exact];
  const ci = names.find((n) => n.toLowerCase() === "data");
  if (ci) return wb.Sheets[ci];
  const firstDataLike = names.find((n) => !/pivot|chart/i.test(n)) ?? names[0];
  return wb.Sheets[firstDataLike];
}

function findHeaderRow(ws: XLSX.WorkSheet, scanRows = 80): { headerRowIdx: number; headers: string[] } {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  let best = { idx: range.s.r, score: -Infinity, headers: [] as string[] };
  const end = Math.min(range.e.r, range.s.r + scanRows - 1);

  for (let r = range.s.r; r <= end; r++) {
    const rowVals: any[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      rowVals.push(cell ? cell.v : null);
    }
    const headers = rowVals.map((v) => (v == null ? "" : String(v)));
    // score by how many synonyms we hit
    let score = 0;
    (Object.keys(SERVICE_COL_SYNONYMS) as LogicalKey[]).forEach((key) => {
      const m = matchOne(headers, SERVICE_COL_SYNONYMS[key]);
      if (m) score += 2;
    });
    if (score > best.score) best = { idx: r, score, headers };
  }
  return { headerRowIdx: best.idx, headers: best.headers };
}

function buildColumnMap(headers: string[]) {
  const map: Partial<Record<LogicalKey, string>> = {};
  (Object.keys(SERVICE_COL_SYNONYMS) as LogicalKey[]).forEach((key) => {
    const m = matchOne(headers, SERVICE_COL_SYNONYMS[key]);
    if (m) map[key] = m;
  });

  const missing = ["serviceType", "weekday", "duration"].filter((k) => !(map as any)[k]);
  if (missing.length) {
    throw new Error(
      `Missing required service columns: ${missing.join(", ")}\n` +
      `Headers found: ${headers.join(" | ")}`
    );
  }
  if (!map.cancellation) map.cancellation = "__missing__";
  return map as Record<LogicalKey, string>;
}

/** MAIN: read a "Hours by Service Type …" workbook buffer and apply rules */
export function applyServiceRules(demandBuffer: Buffer): {
  meta: {
    sheetName: string;
    headerRow: number;
    columnMap: Record<LogicalKey, string>;
    rowsIn: number;
    rowsAfterNormalize: number;
    rowsAfterFilter: number;
  };
  filteredRows: CleanRow[];                            // cleaned data after rules
  hoursByWeekday: Array<{ weekday: string; hours: number }>;
  serviceTypeByWeekday: Map<string, Map<string, number>>;
} {
  // 1) Open workbook and pick the right sheet
  const wb = XLSX.read(demandBuffer);
  const ws = pickBestSheet(wb);

  // 2) Find header row by content; get full matrix
  const { headerRowIdx, headers } = findHeaderRow(ws);
  const matrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true }) as any[][];
  const dataRows = matrix.slice(headerRowIdx + 1);

  // 3) Build column map by header names (with synonyms)
  const colMap = buildColumnMap(headers);
  const headerIndex: Record<string, number> = {};
  headers.forEach((h, i) => (headerIndex[h] = i));

  // 4) Normalize rows
  const normalized: CleanRow[] = [];
  for (const arr of dataRows) {
    if (!arr || arr.length === 0) continue;

    const get = (name: string) => {
      if (name === "__missing__") return null;
      const idx = headerIndex[name];
      return idx == null ? null : arr[idx] ?? null;
    };

    const serviceType = String(get(colMap.serviceType) ?? "").trim();
    const weekday = String(get(colMap.weekday) ?? "").trim();
    const durationRaw = get(colMap.duration);
    const duration = Number(durationRaw ?? 0) || 0;
    const cancellationRaw = get(colMap.cancellation);
    const cancellation = cancellationRaw == null ? null : String(cancellationRaw).trim();

    // Skip blank lines
    if (!serviceType && !weekday && duration === 0) continue;

    normalized.push({ serviceType, weekday, duration, cancellation });
  }

  // 5) RULES: remove cancellations and excluded service types
  // Excluded service types (office hours, night shifts, secondary care, shadowing, on-call)
  const EXCLUDED_TYPES = [
    'office hours',
    'office',
    'nights - sleep in',
    'sleep in',
    'nights - waking nights',
    'waking nights',
    'night',
    'overnight',
    'sleepover',
    'multiple care (secondary)',
    'secondary',
    '(secondary)',
    'shadowing',
    'oncall',  // normalized version (hyphen removed by norm())
    'on call',  // space-separated version
    'training',  // training sessions
    'live in care (sc)',
    'live in care',
    'live-in care'
  ];

  const filtered = normalized.filter((r) => {
    // Check if service type contains any excluded keywords
    const serviceTypeLower = norm(r.serviceType);
    const isExcludedType = EXCLUDED_TYPES.some(excluded => 
      serviceTypeLower.includes(excluded)
    );
    const isCancelled = !!(r.cancellation && r.cancellation.length > 0);
    return !isExcludedType && !isCancelled;
  });

  // Log the filtering process with HOURS breakdown
  const totalFiltered = normalized.length - filtered.length;
  console.log(
    `🔍 SERVICE TYPE FILTERING: Excluded ${totalFiltered} rows (secondary care, night shifts, office hours) from ${normalized.length} normalized rows`,
  );

  // Show breakdown of what was filtered WITH HOURS
  const secondaryRows = normalized.filter(row => {
    const st = norm(row.serviceType);
    return st.includes("multiple care (secondary)") || st.includes("secondary");
  });
  const secondaryHours = secondaryRows.reduce((sum, r) => sum + (r.duration || 0), 0);

  const nightRows = normalized.filter(row => {
    const st = norm(row.serviceType);
    return st.includes("night") || st.includes("sleep in") || st.includes("waking") || st.includes("sleepover") || st.includes("overnight");
  });
  const nightHours = nightRows.reduce((sum, r) => sum + (r.duration || 0), 0);

  const officeRows = normalized.filter(row => {
    const st = norm(row.serviceType);
    return st.includes("office");
  });
  const officeHours = officeRows.reduce((sum, r) => sum + (r.duration || 0), 0);

  const shadowingRows = normalized.filter(row => {
    const st = norm(row.serviceType);
    return st.includes("shadowing");
  });
  const shadowingHours = shadowingRows.reduce((sum, r) => sum + (r.duration || 0), 0);

  const onCallRows = normalized.filter(row => {
    const st = norm(row.serviceType);
    return st.includes("on-call") || st.includes("on call");
  });
  const onCallHours = onCallRows.reduce((sum, r) => sum + (r.duration || 0), 0);

  console.log(`  ❌ Secondary care: ${secondaryRows.length} rows (${Math.round(secondaryHours * 100) / 100}h)`);
  console.log(`  ❌ Night shifts: ${nightRows.length} rows (${Math.round(nightHours * 100) / 100}h)`);
  console.log(`  ❌ Office hours: ${officeRows.length} rows (${Math.round(officeHours * 100) / 100}h)`);
  console.log(`  ❌ Shadowing: ${shadowingRows.length} rows (${Math.round(shadowingHours * 100) / 100}h)`);
  console.log(`  ❌ On-Call: ${onCallRows.length} rows (${Math.round(onCallHours * 100) / 100}h)`);


  // 6) Aggregate outputs
  // 6a) Totals by weekday
  const hoursByWeekdayMap = new Map<string, number>();
  for (const r of filtered) {
    hoursByWeekdayMap.set(r.weekday, (hoursByWeekdayMap.get(r.weekday) || 0) + (r.duration || 0));
  }
  const hoursByWeekday = Array.from(hoursByWeekdayMap.entries())
    .map(([weekday, hours]) => ({ weekday, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => a.weekday.localeCompare(b.weekday));

  // 6b) Pivot: serviceType × weekday
  const pivot = new Map<string, Map<string, number>>();
  for (const r of filtered) {
    if (!pivot.has(r.serviceType)) pivot.set(r.serviceType, new Map());
    const row = pivot.get(r.serviceType)!;
    row.set(r.weekday, (row.get(r.weekday) || 0) + (r.duration || 0));
  }
  // round to 2dp
  for (const m of Array.from(pivot.values())) {
    for (const [k, v] of Array.from(m.entries())) m.set(k, Math.round(v * 100) / 100);
  }

  return {
    meta: {
      sheetName: (wb.SheetNames.find((n) => wb.Sheets[n] === ws) ?? "unknown"),
      headerRow: headerRowIdx,
      columnMap: colMap,
      rowsIn: matrix.length - (headerRowIdx),        // approximate
      rowsAfterNormalize: normalized.length,
      rowsAfterFilter: filtered.length,
    },
    filteredRows: filtered,
    hoursByWeekday,
    serviceTypeByWeekday: pivot,
  };
}