import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DsarExportPayload {
  requestId: string;
  subjectName: string;
  subjectEmail?: string | null;
  generatedAt: string;
  note: string;
  sections: Record<string, Record<string, unknown>[]>;
}

const SECTION_TITLES: Record<string, string> = {
  platformAccount: 'Platform Account',
  auditActivity: 'Audit / Activity Log',
  employeeRecord: 'Employee Record (Care Worker)',
  clientRecord: 'Client Record (Service User)',
  joinerRecord: 'Joiner / Onboarding Record',
  leaverRecord: 'Leaver Record',
  feedbackSubmitted: 'Feedback Submitted',
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (v instanceof Date) return v.toLocaleString('en-GB');
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  // ISO date-like strings — render more readably
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    try { return new Date(s).toLocaleString('en-GB'); } catch { return s; }
  }
  return s;
}

export function exportDsarPdf(payload: DsarExportPayload) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Subject Access Request — Data Export', 14, 18);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90, 90, 90);
  doc.text(`Care Capacity — Home Instead Scottish Group`, 14, 24);
  doc.text(`Generated: ${new Date(payload.generatedAt).toLocaleString('en-GB')}`, 14, 29);

  doc.setDrawColor(200, 200, 200);
  doc.line(14, 33, pageWidth - 14, 33);

  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.text('Data subject:', 14, 40);
  doc.setFont('helvetica', 'normal');
  doc.text(`${payload.subjectName}${payload.subjectEmail ? '  <' + payload.subjectEmail + '>' : ''}`, 44, 40);

  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  const noteLines = doc.splitTextToSize(payload.note, pageWidth - 28);
  doc.text(noteLines, 14, 47);

  let y = 47 + noteLines.length * 4 + 6;

  const sectionKeys = Object.keys(payload.sections);
  let anyData = false;

  for (const key of sectionKeys) {
    const rows = payload.sections[key] || [];
    if (rows.length === 0) continue;
    anyData = true;

    if (y > 260) { doc.addPage(); y = 18; }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(SECTION_TITLES[key] || key, 14, y);
    y += 3;

    const columns = Object.keys(rows[0]).filter(c => !['id', 'branchId'].includes(c));
    const body = rows.map(row => columns.map(c => formatValue(row[c])));

    autoTable(doc, {
      startY: y,
      head: [columns.map(c => c.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()))],
      body,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 100, 70] },
      margin: { left: 14, right: 14 },
      theme: 'grid',
    });

    // @ts-expect-error jspdf-autotable augments doc with lastAutoTable
    y = (doc.lastAutoTable?.finalY ?? y + 20) + 10;
  }

  if (!anyData) {
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text('No matching records were found across application tables for this name/email.', 14, y);
  }

  doc.save(`dsar-export-${payload.subjectName.replace(/\s+/g, '-').toLowerCase()}-${payload.requestId.slice(0, 8)}.pdf`);
}
