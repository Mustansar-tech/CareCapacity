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

function transportLabel(mode?: string): string {
  if (!mode || mode.trim() === '') return '';
  const lower = mode.toLowerCase();
  if (lower.includes('recruiter')) return ' [NEW]';
  if (lower.includes('car') || lower.includes('driv')) return ' [Car]';
  if (lower.includes('walk') || lower.includes('foot') || lower.includes('person')) return ' [Walk]';
  return '';
}

function genderRgb(gender?: string): [number, number, number] | null {
  if (!gender) return null;
  const lower = gender.toLowerCase();
  if (lower === 'female' || lower === 'f') return [185, 40, 95];
  if (lower === 'male' || lower === 'm') return [29, 78, 200];
  return null;
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

  const head = [
    [
      'Day',
      ...allVisits.map(v => v.visitLabel || `Visit ${v.visitIndex + 1}`),
    ],
  ];

  type LineMeta = { text: string; gender?: string };
  type CellMeta = { lines: LineMeta[]; hasContent: boolean; multiColor: boolean };
  const cellMeta: CellMeta[][] = [];

  const body = days.map((day, dayIdx) => {
    const metaRow: CellMeta[] = [{ lines: [{ text: dayFullNames[dayIdx] }], hasContent: false, multiColor: false }];

    const cells = allVisits.map(visit => {
      const { visitIndex, careProsRequired } = visit;
      const textLines: string[] = [];
      const lineMeta: LineMeta[] = [];

      for (let cpIdx = 0; cpIdx < careProsRequired; cpIdx++) {
        const key = `${visitIndex}-${cpIdx}-${day}`;
        const sel = starredMap[key];
        if (sel) {
          const transport = transportLabel(sel.transportMode);
          const nameWithTransport = `${sel.employeeName}${transport}`;
          if (careProsRequired === 1) {
            const line = `${nameWithTransport}  ${sel.timeWindow}`;
            textLines.push(line);
            lineMeta.push({ text: line, gender: sel.gender });
          } else {
            const line = `CP${cpIdx + 1}: ${nameWithTransport}  ${sel.timeWindow}`;
            textLines.push(line);
            lineMeta.push({ text: line, gender: sel.gender });
          }
        }
      }

      const genders = lineMeta.map(l => l.gender);
      const multiColor = lineMeta.length > 1 && genders.some((g, _, arr) => g !== arr[0]);

      metaRow.push({ lines: lineMeta, hasContent: lineMeta.length > 0, multiColor });
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
      fontSize: 9,
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

      const day = days[data.row.index];
      const isWeekend = weekendDays.has(day);
      const meta = cellMeta[data.row.index]?.[data.column.index];

      if (data.column.index === 0) {
        if (isWeekend) data.cell.styles.fillColor = [210, 210, 215];
        return;
      }

      if (!meta?.hasContent) {
        if (isWeekend) data.cell.styles.fillColor = [210, 210, 215];
        return;
      }

      data.cell.styles.fillColor = isWeekend ? [195, 220, 200] : [220, 245, 225];
      data.cell.styles.fontStyle = 'bold';

      if (meta.multiColor) {
        data.cell.styles.textColor = [30, 100, 50];
      } else if (meta.lines.length === 1) {
        const rgb = genderRgb(meta.lines[0].gender);
        data.cell.styles.textColor = rgb ?? [30, 100, 50];
      } else {
        const rgb = genderRgb(meta.lines[0]?.gender);
        data.cell.styles.textColor = rgb ?? [30, 100, 50];
      }
    },

    willDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index === 0) return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta?.hasContent || !meta.multiColor) return;
      (data.cell as unknown as { text: string[] }).text = [];
    },

    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index === 0) return;
      const meta = cellMeta[data.row.index]?.[data.column.index];
      if (!meta?.hasContent || !meta.multiColor) return;

      const { x, y, width, height } = data.cell;
      const padX = 4;
      const padY = 4;
      const lineHeight = 5.2;
      const maxWidth = width - padX * 2;
      let curY = y + padY;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');

      for (const lineMeta of meta.lines) {
        const rgb = genderRgb(lineMeta.gender);
        doc.setTextColor(
          rgb ? rgb[0] : 30,
          rgb ? rgb[1] : 100,
          rgb ? rgb[2] : 50
        );
        const wrapped = doc.splitTextToSize(lineMeta.text, maxWidth);
        for (const segment of wrapped) {
          if (curY + lineHeight > y + height - 1) break;
          doc.text(segment, x + padX, curY + lineHeight * 0.8);
          curY += lineHeight;
        }
      }

      doc.setTextColor(0, 0, 0);
    },
  });

  const safeFilename = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`${safeFilename}_schedule.pdf`);
}
