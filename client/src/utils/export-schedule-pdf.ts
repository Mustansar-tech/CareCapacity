import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface StarredSelection {
  employeeName: string;
  timeWindow: string;
}

interface VisitInfo {
  visitIndex: number;
  visitLabel: string;
  careProsRequired: number;
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
      ...allVisits.map(
        v => v.visitLabel || `Visit ${v.visitIndex + 1}`
      ),
    ],
  ];

  const body = days.map((day, dayIdx) => {
    const cells = allVisits.map(visit => {
      const { visitIndex, careProsRequired } = visit;
      const lines: string[] = [];
      for (let cpIdx = 0; cpIdx < careProsRequired; cpIdx++) {
        const key = `${visitIndex}-${cpIdx}-${day}`;
        const sel = starredMap[key];
        if (sel) {
          if (careProsRequired === 1) {
            lines.push(`${sel.employeeName}  ${sel.timeWindow}`);
          } else {
            lines.push(`CP${cpIdx + 1}: ${sel.employeeName}  ${sel.timeWindow}`);
          }
        }
      }
      return lines.join('\n');
    });
    return [dayFullNames[dayIdx], ...cells];
  });

  const startY = subtitle ? 26 : 19;

  autoTable(doc, {
    head,
    body,
    startY,
    styles: {
      fontSize: 9,
      cellPadding: { top: 5, right: 4, bottom: 5, left: 4 },
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
      if (data.section === 'body') {
        const day = days[data.row.index];
        if (weekendDays.has(day)) {
          data.cell.styles.fillColor = [210, 210, 215];
        }
        if (data.column.index > 0) {
          const cellText = Array.isArray(data.cell.raw)
            ? data.cell.raw.join('')
            : String(data.cell.raw ?? '');
          if (cellText.trim()) {
            data.cell.styles.fillColor = weekendDays.has(day)
              ? [195, 220, 200]
              : [220, 245, 225];
            data.cell.styles.textColor = [30, 100, 50];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    },
  });

  const safeFilename = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`${safeFilename}_schedule.pdf`);
}
