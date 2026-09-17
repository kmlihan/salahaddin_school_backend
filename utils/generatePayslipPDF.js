const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Minimalist payslip layout (one page, A4 portrait, 50pt margins):
 *
 *   ISSUED TO                    PAY PERIOD
 *   Name                         From:    DD/MM/YYYY
 *   Email                        To:      DD/MM/YYYY
 *   Phone                        Issued:  DD/MM/YYYY
 *   ────────────────────────────────────────────
 *   EARNINGS
 *   Description       Hours    Rate     Amount
 *   ...rows...
 *   ────────────────────────────────────────────
 *                            ┌─────────────┐
 *                            │ TOTAL DUE   │
 *                            │ € XX.XX     │
 *                            └─────────────┘
 *
 *   NOTES (if any)
 *
 *   Authorised signature       Teacher signature
 *   ___________________        ___________________
 *
 * No brand header, reference, or footer. Sections flow naturally with a
 * tracked Y cursor so the page never overflows.
 */

const PALETTE = {
  primary:    '#0D274D',
  primaryFg:  '#FFFFFF',
  accent:     '#C9A054',
  ink:        '#111827',
  body:       '#374151',
  muted:      '#6B7280',
  divider:    '#E5E7EB',
  zebra:      '#F8FAFC',
};

function generatePayslipPDF(payment, teacher) {
  return new Promise((resolve, reject) => {
    try {
      const dir = path.join(__dirname, '..', 'uploads', 'payslips');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const fileName = `payslip_${payment._id}.pdf`;
      const filePath = path.join(dir, fileName);
      const stream = fs.createWriteStream(filePath);

      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      doc.pipe(stream);

      // Track the cursor ourselves so each section knows where to start.
      // Starts at the top margin (50).
      let y = 50;

      y = drawInfoColumns(doc, y, teacher, payment);
      y = drawEarningsTable(doc, y, payment);
      y = drawTotalsPanel(doc, y, payment);
      if (payment.notes) y = drawNotes(doc, y, payment.notes);
      drawSignatures(doc, y);

      doc.end();
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/* ------------------------------------------------------- shared helpers */

const eur = (n) => `€ ${Number(n || 0).toFixed(2)}`;
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

/* ---------------------------------------------- "Issued to" + "Pay period" */

function drawInfoColumns(doc, startY, teacher, payment) {
  const colW = 240;
  const leftX = 50;
  const rightX = doc.page.width - 50 - colW;
  let y = startY;

  // Column titles + thin underlines
  doc.font('Helvetica-Bold').fontSize(10).fillColor(PALETTE.muted);
  doc.text('ISSUED TO', leftX, y, { lineBreak: false });
  doc.text('PAY PERIOD', rightX, y, { lineBreak: false });

  y += 14;
  doc.strokeColor(PALETTE.divider).lineWidth(0.8)
     .moveTo(leftX, y).lineTo(leftX + colW, y).stroke()
     .moveTo(rightX, y).lineTo(rightX + colW, y).stroke();
  y += 8;

  // Left column — teacher details
  doc.font('Helvetica-Bold').fontSize(12).fillColor(PALETTE.ink)
     .text(`${teacher.firstName} ${teacher.lastName}`, leftX, y, { width: colW });
  doc.font('Helvetica').fontSize(10).fillColor(PALETTE.body)
     .text(teacher.email || '', leftX, doc.y, { width: colW })
     .text(teacher.phone || '', leftX, doc.y, { width: colW });
  const leftBottom = doc.y;

  // Right column — period (manually positioned so both columns share the
  // same starting Y and grow independently without affecting each other)
  let ry = y;
  const labelW = 60;
  drawKV(doc, rightX, ry,        labelW, 'From:',   fmt(payment.periodFrom)); ry += 16;
  drawKV(doc, rightX, ry,        labelW, 'To:',     fmt(payment.periodTo));   ry += 16;
  drawKV(doc, rightX, ry,        labelW, 'Issued:', fmt(payment.createdAt));  ry += 16;
  const rightBottom = ry;

  return Math.max(leftBottom, rightBottom) + 24;
}

function drawKV(doc, x, y, labelW, label, value) {
  doc.font('Helvetica').fontSize(10);
  doc.fillColor(PALETTE.muted).text(label, x, y, { width: labelW, lineBreak: false });
  doc.fillColor(PALETTE.ink).text(String(value), x + labelW, y, { lineBreak: false });
}

/* ---------------------------------------------------------- earnings table */

function drawEarningsTable(doc, startY, payment) {
  const x = 50;
  const w = doc.page.width - 100;
  let y = startY;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(PALETTE.muted)
     .text('EARNINGS', x, y, { lineBreak: false });
  y += 14;

  const cols = [
    { label: 'Description', x: x + 10,  w: 220, align: 'left'  },
    { label: 'Hours',       x: x + 240, w: 70,  align: 'right' },
    { label: 'Rate',        x: x + 320, w: 80,  align: 'right' },
    { label: 'Amount',      x: x + 410, w: 90,  align: 'right' },
  ];

  // Header row
  doc.rect(x, y, w, 22).fill(PALETTE.primary);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(PALETTE.primaryFg);
  for (const c of cols) {
    doc.text(c.label, c.x, y + 6, { width: c.w, align: c.align, lineBreak: false });
  }
  y += 22;

  // Rows: from `breakdown` if present, otherwise a single fallback row.
  const rate = Number(payment.hourlyRate || 0);
  const rows = (Array.isArray(payment.breakdown) && payment.breakdown.length > 0)
    ? payment.breakdown.map((b) => {
        const hourCount = (b.hours || []).length;
        const dateLabel = new Date(b.date).toLocaleDateString('en-GB');
        const hoursText = (b.hours || []).join(', ') || '—';
        return {
          desc: `${dateLabel}  ·  hours: ${hoursText}`,
          hours: hourCount,
          amount: hourCount * rate,
        };
      })
    : [{
        desc: 'Teaching hours',
        hours: Number(payment.hoursWorked || 0),
        amount: Number(payment.grossAmount || 0),
      }];

  const rowH = 22;
  doc.font('Helvetica').fontSize(10);
  rows.forEach((row, i) => {
    if (i % 2 === 0) doc.rect(x, y, w, rowH).fill(PALETTE.zebra);
    doc.fillColor(PALETTE.ink);
    doc.text(row.desc,            cols[0].x, y + 7, { width: cols[0].w, align: cols[0].align, lineBreak: false });
    doc.text(String(row.hours),   cols[1].x, y + 7, { width: cols[1].w, align: cols[1].align, lineBreak: false });
    doc.text(eur(rate),           cols[2].x, y + 7, { width: cols[2].w, align: cols[2].align, lineBreak: false });
    doc.text(eur(row.amount),     cols[3].x, y + 7, { width: cols[3].w, align: cols[3].align, lineBreak: false });
    y += rowH;
  });

  doc.strokeColor(PALETTE.divider).lineWidth(0.8)
     .moveTo(x, y).lineTo(x + w, y).stroke();

  return y + 16;
}

/* ----------------------------------------------------------- totals panel */

function drawTotalsPanel(doc, startY, payment) {
  const w = 200;
  const h = 56;
  const x = doc.page.width - 50 - w;
  const y = startY;

  doc.rect(x, y, w, h).fill(PALETTE.primary);
  doc.font('Helvetica').fontSize(10).fillColor('#FFFFFFCC')
     .text('TOTAL DUE', x + 14, y + 10, { width: w - 28, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(PALETTE.primaryFg)
     .text(eur(payment.grossAmount), x + 14, y + 24, { width: w - 28, lineBreak: false });

  // Slim accent stripe on the leading edge.
  doc.rect(x, y, 4, h).fill(PALETTE.accent);

  return y + h + 24;
}

/* ----------------------------------------------------------------- notes */

function drawNotes(doc, startY, notes) {
  const x = 50;
  const w = doc.page.width - 100;
  let y = startY;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(PALETTE.muted)
     .text('NOTES', x, y, { lineBreak: false });
  y += 14;

  doc.font('Helvetica').fontSize(10).fillColor(PALETTE.body);
  doc.text(String(notes), x, y, { width: w });

  return doc.y + 16;
}

/* ------------------------------------------------------------- signatures */

/**
 * Signature block flows naturally after the body content, with a small
 * extra gap. We anchor it to AT LEAST a known Y (so it doesn't sit too
 * close to a short body), but never push it off the page.
 *
 * Two columns side by side: authorised on the left, teacher on the right.
 */
function drawSignatures(doc, afterBodyY) {
  // Sit comfortably below the body. If the body ended early, push the
  // signatures down to ~600 so they don't look orphaned right below the
  // total. If the body ended late, keep the natural position.
  const minY = 600;
  let y = Math.max(afterBodyY + 24, minY);

  // Last-resort safety: never pass the bottom margin. If we'd be too low,
  // pull the signatures up to a sensible bottom-anchored position. This
  // also prevents PDFKit from auto-pagebreaking.
  const bottomCap = doc.page.height - 100;
  if (y > bottomCap) y = bottomCap;

  const colW = 220;
  const left = 50;
  const right = doc.page.width - 50 - colW;
  const lineY = y + 30;

  doc.font('Helvetica').fontSize(10).fillColor(PALETTE.muted);
  doc.text('Authorised signature', left, y,  { width: colW, lineBreak: false });
  doc.text('Teacher signature',    right, y, { width: colW, lineBreak: false });

  doc.strokeColor(PALETTE.ink).lineWidth(0.8)
     .moveTo(left,  lineY).lineTo(left + colW,  lineY).stroke()
     .moveTo(right, lineY).lineTo(right + colW, lineY).stroke();

  doc.fontSize(8).fillColor(PALETTE.muted);
  doc.text('Signature & date', left, lineY + 4, { width: colW, lineBreak: false });
  doc.text('Date: __________________', right, lineY + 4, { width: colW, lineBreak: false });
}

module.exports = generatePayslipPDF;
