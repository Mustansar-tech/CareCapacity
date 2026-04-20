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

// ── SVG icons matching lucide-react Car and PersonStanding ──────────────────
const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17H5a2 2 0 0 1-2-2V9a2 2 0 0 1 .586-1.414L6 5h12l2.414 2.586A2 2 0 0 1 21 9v6a2 2 0 0 1-2 2Z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>`;

const WALK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.5"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="m12 10-2 5"/></svg>`;

async function svgToPng(svgStr: string, size: number): Promise<string> {
  return new Promise((resolve) => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(''); return; }
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}

function genderRgb(gender?: string): [number, number, number] {
  if (!gender) return [30, 100, 50];
  const lower = gender.toLowerCase();
  if (lower === 'female' || lower === 'f') return [185, 40, 95];
  if (lower === 'male' || lower === 'm') return [29, 78, 200];
  return [30, 100, 50];
}

function normalizeTransport(mode?: string): 'car' | 'walk' | 'recruiter' | null {
  if (!mode || mode.trim() === '') return null;
  const lower = mode.toLowerCase();
  if (lower.includes('recruiter')) return 'recruiter';
  if (lower.includes('car') || lower.includes('driv')) return 'car';
  if (lower.includes('walk') || lower.includes('foot') || lower.includes('person')) return 'walk';
  return null;
}

export async function exportSchedulePdf(
  starredMap: Record<string, StarredSelection>,
  clientName: string,
  postcode: string | undefined,
  enquiryTimeStart: string | undefined,
  enquiryTimeEnd: string | undefined,
  allVisits: VisitInfo[]
) {
  // Pre-generate transport icon PNGs (32×32 for good resolution at small display size)
  const [carPng, walkPng] = await Promise.all([
    svgToPng(CAR_SVG, 32),
    svgToPng(WALK_SVG, 32),
  ]);

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

  // ── Derive max CP index per visit from starred keys (fixes CP2 not showing) ──
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

  // Ensure allVisits careProsRequired covers all starred CPs
  const resolvedVisits = allVisits.map(v => ({
    ...v,
    careProsRequired: Math.max(v.careProsRequired, (maxCpByVisit[v.visitIndex] ?? 0) + 1),
  }));

  const head = [['Day', ...resolvedVisits.map(v => v.visitLabel || `Visit ${v.visitIndex + 1}`)]];

  type LineMeta = {
    prefix: string;       // e.g. "CP1: " or ""
    name: string;
    timeWindow: string;
    gender?: string;
    transport: 'car' | 'walk' | 'recruiter' | null;
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
            transport: normalizeTransport(sel.transportMode),
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

  autoTable(doc, {
    head,
    body,
    startY,
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
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
      // Suppress default text so we can draw each line in its own color + icon
      const textArr = data.cell.text as string[];
      textArr.splice(0, textArr.length);
    },

    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index === 0) return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta?.hasContent) return;

      const { x, y, width, height } = data.cell;
      const padX = 4;
      const padY = 4;
      const iconSize = 3.5;        // mm — small icon next to the name
      const iconGap = 1;           // gap after icon
      const lineHeight = 5.5;
      const maxTextWidth = width - padX * 2 - iconSize - iconGap;
      let curY = y + padY + lineHeight * 0.7;

      doc.setFontSize(8.5);

      for (const line of meta.lines) {
        if (curY > y + height - 2) break;
        const rgb = genderRgb(line.gender);
        const iconX = x + padX;
        const textX = iconX + iconSize + iconGap;

        // Draw transport icon (PNG)
        if (line.transport === 'car' && carPng) {
          try { doc.addImage(carPng, 'PNG', iconX, curY - iconSize + 0.5, iconSize, iconSize); } catch (_) {}
        } else if (line.transport === 'walk' && walkPng) {
          try { doc.addImage(walkPng, 'PNG', iconX, curY - iconSize + 0.5, iconSize, iconSize); } catch (_) {}
        } else if (line.transport === 'recruiter') {
          doc.setFontSize(6);
          doc.setTextColor(180, 110, 10);
          doc.setFont('helvetica', 'bold');
          doc.text('NEW', iconX, curY, { maxWidth: iconSize + iconGap });
          doc.setFontSize(8.5);
        }

        // CP prefix in neutral color
        if (line.prefix) {
          doc.setTextColor(80, 80, 80);
          doc.setFont('helvetica', 'normal');
          const prefixW = doc.getTextWidth(line.prefix);
          doc.text(line.prefix, textX, curY, { maxWidth: maxTextWidth });
          // Name in gender color
          doc.setTextColor(rgb[0], rgb[1], rgb[2]);
          doc.setFont('helvetica', 'bold');
          doc.text(line.name, textX + prefixW, curY, { maxWidth: maxTextWidth - prefixW });
          // Time window
          const nameW = doc.getTextWidth(line.name);
          doc.setTextColor(60, 80, 60);
          doc.setFont('helvetica', 'normal');
          doc.text(`  ${line.timeWindow}`, textX + prefixW + nameW, curY, { maxWidth: maxTextWidth - prefixW - nameW });
        } else {
          // Name in gender color
          doc.setTextColor(rgb[0], rgb[1], rgb[2]);
          doc.setFont('helvetica', 'bold');
          doc.text(line.name, textX, curY, { maxWidth: maxTextWidth });
          // Time window after name
          const nameW = doc.getTextWidth(line.name);
          doc.setTextColor(60, 80, 60);
          doc.setFont('helvetica', 'normal');
          doc.text(`  ${line.timeWindow}`, textX + nameW, curY, { maxWidth: maxTextWidth - nameW });
        }

        curY += lineHeight;
      }

      // Reset
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
    },
  });

  const safeFilename = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`${safeFilename}_schedule.pdf`);
}
