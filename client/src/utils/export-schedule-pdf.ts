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

function getTransportType(raw?: string): 'car' | 'walking' | 'recruiter' | null {
  if (!raw || raw.trim() === '') return null;
  const s = raw.toLowerCase().trim();
  if (s.includes('recruiter')) return 'recruiter';
  if (s.includes('walk') || s.includes('foot') || s.includes('pedestrian')) return 'walking';
  return 'car';
}

function genderRgb(gender?: string): [number, number, number] {
  if (!gender) return [30, 100, 50];
  const v = gender.toLowerCase().trim();
  if (v === 'female' || v === 'f' || v === 'miss' || v === 'ms' || v === 'mrs') return [185, 40, 95];
  if (v === 'male' || v === 'm' || v === 'mr') return [29, 78, 200];
  return [30, 100, 50];
}

function drawCarIcon(doc: jsPDF, x: number, y: number, s: number) {
  const r = 37, g = 99, b = 235;
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.4);
  doc.roundedRect(x + s * 0.22, y + s * 0.08, s * 0.56, s * 0.32, 0.5, 0.5, 'S');
  doc.roundedRect(x + s * 0.04, y + s * 0.32, s * 0.92, s * 0.42, 0.5, 0.5, 'S');
  doc.setFillColor(r, g, b);
  doc.circle(x + s * 0.26, y + s * 0.82, s * 0.13, 'F');
  doc.circle(x + s * 0.74, y + s * 0.82, s * 0.13, 'F');
  doc.setFillColor(255, 255, 255);
  doc.circle(x + s * 0.26, y + s * 0.82, s * 0.06, 'F');
  doc.circle(x + s * 0.74, y + s * 0.82, s * 0.06, 'F');
}

function drawWalkIcon(doc: jsPDF, x: number, y: number, s: number) {
  const r = 22, g = 163, b = 74;
  doc.setDrawColor(r, g, b);
  doc.setFillColor(r, g, b);
  doc.setLineWidth(0.5);
  doc.circle(x + s * 0.55, y + s * 0.13, s * 0.13, 'F');
  doc.line(x + s * 0.55, y + s * 0.26, x + s * 0.48, y + s * 0.60);
  doc.line(x + s * 0.52, y + s * 0.35, x + s * 0.22, y + s * 0.47);
  doc.line(x + s * 0.52, y + s * 0.35, x + s * 0.74, y + s * 0.28);
  doc.line(x + s * 0.48, y + s * 0.60, x + s * 0.26, y + s * 0.90);
  doc.line(x + s * 0.48, y + s * 0.60, x + s * 0.70, y + s * 0.88);
}

function drawRecruiterBadge(doc: jsPDF, x: number, y: number, s: number) {
  doc.setFillColor(234, 88, 12);
  doc.roundedRect(x, y, s * 1.8, s * 0.9, 0.5, 0.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text('NEW', x + s * 0.2, y + s * 0.7);
}

// Draw a small CP number badge (e.g. "1" or "2") in a rounded pill
function drawCpBadge(doc: jsPDF, x: number, y: number, num: number) {
  const bw = 4;
  const bh = 3.2;
  doc.setFillColor(55, 65, 120);
  doc.roundedRect(x, y, bw, bh, 0.6, 0.6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.text(String(num), x + bw / 2, y + bh * 0.73, { align: 'center' });
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

  // ── Header ─────────────────────────────────────────────────────────────────
  const title = [clientName, postcode].filter(Boolean).join('  –  ');
  const subtitle = '';

  // Accent bar
  doc.setFillColor(20, 20, 30);
  doc.rect(0, 0, 297, 5, 'F');

  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 30);
  doc.text(title, 14, 15);

  let headerBottom = 19;
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 110);
    doc.text(subtitle, 14, 22);
    headerBottom = 26;
  }

  // Generated date (right-aligned)
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 150);
  doc.text(`Generated: ${dateStr}`, 283, 8, { align: 'right' });

  doc.setTextColor(0, 0, 0);

  // ── Data prep ──────────────────────────────────────────────────────────────
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayFullNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekendDays = new Set(['sat', 'sun']);

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
    cpNum: number;
    isDoubleUp: boolean;
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
    const metaRow: CellMeta[] = [{ lines: [], hasContent: false, fillColor: [240, 240, 246] }];
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
            cpNum: cpIdx + 1,
            isDoubleUp: careProsRequired > 1,
            name: sel.employeeName,
            timeWindow: sel.timeWindow,
            gender: sel.gender,
            transport: getTransportType(sel.transportMode),
          });
        }
      }

      const hasContent = lineMeta.length > 0;
      const fillColor: [number, number, number] = hasContent
        ? (isWeekend ? [195, 222, 202] : [218, 244, 224])
        : (isWeekend ? [208, 208, 213] : [255, 255, 255]);

      metaRow.push({ lines: lineMeta, hasContent, fillColor });
      return textLines.join('\n');
    });

    cellMeta.push(metaRow);
    return [dayFullNames[dayIdx], ...cells];
  });

  // ── Layout constants ───────────────────────────────────────────────────────
  const startY = headerBottom + 2;
  const iconSize = 4.5;
  const iconGap = 1.5;
  const badgeW = 4;
  const badgeGap = 1.2;
  const lineH = 5.8;
  const padX = 5;
  const padY = 3;

  autoTable(doc, {
    head,
    body,
    startY,
    styles: {
      fontSize: 9,
      cellPadding: { top: padY, right: padX, bottom: padY, left: padX },
      lineColor: [200, 200, 205],
      lineWidth: 0.3,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [20, 20, 30],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9.5,
      halign: 'center',
      cellPadding: { top: 3.5, right: 4, bottom: 3.5, left: 4 },
    },
    columnStyles: {
      0: {
        fontStyle: 'bold',
        fontSize: 9.5,
        cellWidth: 32,
        halign: 'center',
        valign: 'middle',
        fillColor: [240, 240, 246],
        textColor: [40, 40, 60],
      },
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },

    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta) return;
      data.cell.styles.fillColor = meta.fillColor;
      if (data.column.index > 0 && meta.hasContent) {
        const numLines = meta.lines.length;
        if (numLines > 0) {
          data.cell.styles.minCellHeight = padY * 2 + numLines * lineH;
        }
      }
    },

    willDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index === 0) return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta?.hasContent) return;
      const t = data.cell.text as string[];
      t.splice(0, t.length);
    },

    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index === 0) return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta?.hasContent) return;

      const { x, y, width, height } = data.cell;
      let curY = y + padY + lineH * 0.78;

      for (let li = 0; li < meta.lines.length; li++) {
        const line = meta.lines[li];
        if (curY > y + height - 1) break;

        let drawX = x + padX;

        // Transport icon
        const iconY = curY - iconSize * 0.82;
        if (line.transport === 'car') {
          drawCarIcon(doc, drawX, iconY, iconSize);
        } else if (line.transport === 'walking') {
          drawWalkIcon(doc, drawX, iconY, iconSize);
        } else if (line.transport === 'recruiter') {
          drawRecruiterBadge(doc, drawX, iconY + iconSize * 0.05, iconSize);
        }
        drawX += iconSize + iconGap;

        // CP number badge (only for double-ups)
        if (line.isDoubleUp) {
          drawCpBadge(doc, drawX, curY - lineH * 0.55, line.cpNum);
          drawX += badgeW + badgeGap;
        }

        const maxW = x + width - padX - drawX;

        // Name in gender colour, bold, 10pt
        const rgb = genderRgb(line.gender);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        const nameW = doc.getTextWidth(line.name);
        doc.text(line.name, drawX, curY, { maxWidth: maxW });

        // Time window — 8.5pt, muted slate
        const timeX = drawX + nameW + 3;
        if (timeX < x + width - padX - 10) {
          doc.setFontSize(8.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(90, 110, 95);
          doc.text(line.timeWindow, timeX, curY, { maxWidth: x + width - padX - timeX });
        }

        curY += lineH;
      }

      // Reset graphics state
      doc.setDrawColor(0);
      doc.setFillColor(255, 255, 255);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.setLineWidth(0.3);
    },
  });

  // ── Footer ─────────────────────────────────────────────────────────────────
  const pageH = 210;
  doc.setFontSize(7.5);
  doc.setTextColor(160, 160, 170);
  doc.text('Care Capacity Dashboard  ·  Proposed Weekly Schedule', 14, pageH - 4);
  doc.text('Page 1', 283, pageH - 4, { align: 'right' });

  const safeFilename = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`${safeFilename}_schedule.pdf`);
}
