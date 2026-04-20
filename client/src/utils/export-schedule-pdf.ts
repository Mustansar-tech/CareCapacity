import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface StarredSelection {
  employeeName: string;
  timeWindow: string;
  gender?: string;
  transportMode?: string;
}

interface VisitInfo {
  visitIndex: number;
  visitLabel: string;
  careProsRequired: number;
}

// ── Matches normalizeTransportMode from bd-matrix-utils ─────────────────────
function getTransportType(raw?: string): 'car' | 'walking' | 'recruiter' | null {
  if (!raw || raw.trim() === '') return null;
  const s = raw.toLowerCase().trim();
  if (s.includes('recruiter')) return 'recruiter';
  if (s.includes('walk') || s.includes('foot') || s.includes('pedestrian')) return 'walking';
  return 'car'; // default (same as normalizeTransportMode)
}

// ── Matches normalizeGender from bd-matrix-utils ─────────────────────────────
function genderRgb(gender?: string): [number, number, number] {
  if (!gender) return [30, 100, 50];
  const v = gender.toLowerCase().trim();
  if (v === 'female' || v === 'f' || v === 'miss' || v === 'ms' || v === 'mrs') return [185, 40, 95];
  if (v === 'male' || v === 'm' || v === 'mr') return [29, 78, 200];
  return [30, 100, 50];
}

// ── Vector car icon (blue) ───────────────────────────────────────────────────
function drawCarIcon(doc: jsPDF, x: number, y: number, s: number) {
  const r = 37, g = 99, b = 235;
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.35);
  // Roof
  doc.roundedRect(x + s * 0.22, y + s * 0.08, s * 0.56, s * 0.32, 0.4, 0.4, 'S');
  // Body
  doc.roundedRect(x + s * 0.04, y + s * 0.32, s * 0.92, s * 0.42, 0.4, 0.4, 'S');
  // Wheels
  doc.setFillColor(r, g, b);
  doc.circle(x + s * 0.26, y + s * 0.82, s * 0.13, 'F');
  doc.circle(x + s * 0.74, y + s * 0.82, s * 0.13, 'F');
  // Hubcaps
  doc.setFillColor(255, 255, 255);
  doc.circle(x + s * 0.26, y + s * 0.82, s * 0.06, 'F');
  doc.circle(x + s * 0.74, y + s * 0.82, s * 0.06, 'F');
}

// ── Vector walking-person icon (green) ──────────────────────────────────────
function drawWalkIcon(doc: jsPDF, x: number, y: number, s: number) {
  const r = 22, g = 163, b = 74;
  doc.setDrawColor(r, g, b);
  doc.setFillColor(r, g, b);
  doc.setLineWidth(0.35);
  // Head
  doc.circle(x + s * 0.55, y + s * 0.13, s * 0.12, 'F');
  // Body
  doc.line(x + s * 0.55, y + s * 0.25, x + s * 0.48, y + s * 0.60);
  // Arms
  doc.line(x + s * 0.52, y + s * 0.35, x + s * 0.25, y + s * 0.45);
  doc.line(x + s * 0.52, y + s * 0.35, x + s * 0.72, y + s * 0.28);
  // Legs
  doc.line(x + s * 0.48, y + s * 0.60, x + s * 0.28, y + s * 0.90);
  doc.line(x + s * 0.48, y + s * 0.60, x + s * 0.68, y + s * 0.88);
}

// ── Recruiter dot (amber) ────────────────────────────────────────────────────
function drawRecruiterBadge(doc: jsPDF, x: number, y: number, s: number) {
  doc.setFillColor(251, 146, 60);
  doc.roundedRect(x, y, s * 1.6, s * 0.85, 0.3, 0.3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(5);
  doc.setFont('helvetica', 'bold');
  doc.text('NEW', x + s * 0.18, y + s * 0.65);
}

export function exportSchedulePdf(
  starredMap: Record<string, StarredSelection>,
  clientName: string,
  postcode: string | undefined,
  enquiryTimeStart: string | undefined,
  enquiryTimeEnd: string | undefined,
  allVisits: VisitInfo[]
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const title = [clientName, postcode].filter(Boolean).join('  –  ');
  const subtitle =
    enquiryTimeStart && enquiryTimeEnd
      ? `Visit time: ${enquiryTimeStart} – ${enquiryTimeEnd}`
      : '';

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 14);

  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 90, 90);
    doc.text(subtitle, 14, 21);
    doc.setTextColor(0, 0, 0);
  }

  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayFullNames = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ];
  const weekendDays = new Set(['sat', 'sun']);

  // Derive max CP index per visit directly from the starred keys
  const maxCpByVisit: Record<number, number> = {};
  for (const key of Object.keys(starredMap)) {
    const parts = key.split('-');
    if (parts.length < 3) continue;
    const vi = parseInt(parts[0]);
    const cp = parseInt(parts[1]);
    if (!isNaN(vi) && !isNaN(cp)) {
      if (maxCpByVisit[vi] === undefined || cp > maxCpByVisit[vi]) {
        maxCpByVisit[vi] = cp;
      }
    }
  }

  const resolvedVisits = allVisits.map(v => ({
    ...v,
    careProsRequired: Math.max(v.careProsRequired, (maxCpByVisit[v.visitIndex] ?? 0) + 1),
  }));

  const head = [['Day', ...resolvedVisits.map(v => v.visitLabel || `Visit ${v.visitIndex + 1}`)]];

  type LineMeta = {
    prefix: string;
    name: string;
    timeWindow: string;
    gender?: string;
    transport: 'car' | 'walking' | 'recruiter' | null;
  };
  type CellMeta = {
    lines: LineMeta[];
    hasContent: boolean;
    fillColor: [number, number, number];
  };
  const cellMeta: CellMeta[][] = [];

  const body = days.map((day, dayIdx) => {
    const metaRow: CellMeta[] = [{ lines: [], hasContent: false, fillColor: [245, 245, 250] }];
    const isWeekend = weekendDays.has(day);

    const cells = resolvedVisits.map(visit => {
      const { visitIndex, careProsRequired } = visit;
      const textLines: string[] = [];
      const lineMeta: LineMeta[] = [];

      for (let cpIdx = 0; cpIdx < careProsRequired; cpIdx++) {
        const key = `${visitIndex}-${cpIdx}-${day}`;
        const sel = starredMap[key];
        if (sel) {
          const prefix = careProsRequired > 1 ? `CP${cpIdx + 1}: ` : '';
          textLines.push(`${prefix}${sel.employeeName}  ${sel.timeWindow}`);
          lineMeta.push({
            prefix,
            name: sel.employeeName,
            timeWindow: sel.timeWindow,
            gender: sel.gender,
            transport: getTransportType(sel.transportMode),
          });
        }
      }

      const hasContent = lineMeta.length > 0;
      const fillColor: [number, number, number] = hasContent
        ? (isWeekend ? [195, 220, 200] : [220, 245, 225])
        : (isWeekend ? [210, 210, 215] : [255, 255, 255]);

      metaRow.push({ lines: lineMeta, hasContent, fillColor });
      return textLines.join('\n');
    });

    cellMeta.push(metaRow);
    return [dayFullNames[dayIdx], ...cells];
  });

  const startY = subtitle ? 26 : 19;
  const iconSize = 3.5;
  const iconGap = 1.2;
  const lineH = 5.8;
  const padX = 4;
  const padY = 3.5;

  autoTable(doc, {
    head,
    body,
    startY,
    styles: {
      fontSize: 8.5,
      cellPadding: { top: padY, right: padX, bottom: padY, left: padX },
      lineColor: [180, 180, 180],
      lineWidth: 0.25,
      valign: 'top',
    },
    headStyles: {
      fillColor: [20, 20, 30],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 28, halign: 'left', fillColor: [245, 245, 250] },
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },

    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta) return;
      data.cell.styles.fillColor = meta.fillColor;
      if (data.column.index > 0 && meta.hasContent) {
        data.cell.styles.fontStyle = 'bold';
      }
    },

    willDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index === 0) return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta?.hasContent) return;
      // Suppress default text — we draw everything manually in didDrawCell
      const t = data.cell.text as string[];
      t.splice(0, t.length);
    },

    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index === 0) return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta?.hasContent) return;

      const { x, y, width, height } = data.cell;
      const maxW = width - padX * 2 - iconSize - iconGap;
      let curY = y + padY + lineH * 0.72;

      doc.setFontSize(8.5);

      for (const line of meta.lines) {
        if (curY > y + height - 1.5) break;

        const iconY = curY - iconSize * 0.82;
        const iconX = x + padX;
        const textX = iconX + iconSize + iconGap;

        // Transport icon
        if (line.transport === 'car') {
          drawCarIcon(doc, iconX, iconY, iconSize);
        } else if (line.transport === 'walking') {
          drawWalkIcon(doc, iconX, iconY, iconSize);
        } else if (line.transport === 'recruiter') {
          drawRecruiterBadge(doc, iconX, iconY + iconSize * 0.1, iconSize);
        }

        const rgb = genderRgb(line.gender);

        if (line.prefix) {
          // "CP1: " in grey
          doc.setTextColor(100, 100, 100);
          doc.setFont('helvetica', 'normal');
          const prefW = doc.getTextWidth(line.prefix);
          doc.text(line.prefix, textX, curY);

          // Name in gender colour
          doc.setTextColor(rgb[0], rgb[1], rgb[2]);
          doc.setFont('helvetica', 'bold');
          const nameW = doc.getTextWidth(line.name);
          doc.text(line.name, textX + prefW, curY, { maxWidth: maxW - prefW });

          // Time window in muted green
          doc.setTextColor(70, 100, 70);
          doc.setFont('helvetica', 'normal');
          doc.text(`  ${line.timeWindow}`, textX + prefW + nameW, curY, { maxWidth: maxW - prefW - nameW });
        } else {
          // Name in gender colour
          doc.setTextColor(rgb[0], rgb[1], rgb[2]);
          doc.setFont('helvetica', 'bold');
          const nameW = doc.getTextWidth(line.name);
          doc.text(line.name, textX, curY, { maxWidth: maxW });

          // Time window
          doc.setTextColor(70, 100, 70);
          doc.setFont('helvetica', 'normal');
          doc.text(`  ${line.timeWindow}`, textX + nameW, curY, { maxWidth: maxW - nameW });
        }

        curY += lineH;
      }

      // Reset state
      doc.setDrawColor(0);
      doc.setFillColor(255, 255, 255);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.setLineWidth(0.25);
    },
  });

  const safeFilename = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`${safeFilename}_schedule.pdf`);
}
