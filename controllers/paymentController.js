const asyncHandler = require('express-async-handler');
const path = require('path');
const fs = require('fs');
const Payment = require('../models/Payment');
const Teacher = require('../models/Teacher');
const TeacherAttendance = require('../models/TeacherAttendance');
const generatePayslipPDF = require('../utils/generatePayslipPDF');

/* ---------- date helpers (mirror teacherAttendanceController) ---------- */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayRange(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const start = startOfDay(d);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Find an existing payment for this teacher whose period overlaps the
 * proposed range. Returns the conflicting payment (with teacher populated)
 * or null. Optionally pass `excludeId` so update() can exclude the record
 * being edited from the comparison.
 *
 * Why overlap, not exact match? Exact match would let someone issue a
 * payslip for Apr 1 → May 1 and then a second one for Apr 15 → May 15 —
 * silently double-paying the teacher for the overlap. Overlap detection
 * makes that mistake impossible without an explicit force flag.
 *
 * Standard interval overlap: [A1, A2] and [B1, B2] overlap iff
 * A1 <= B2 && A2 >= B1. Translated to Mongo:
 *   periodFrom <= toDate    AND   periodTo >= fromDate
 */
async function findOverlappingPayment({ teacher, fromDate, toDate, excludeId = null }) {
  if (!fromDate || !toDate) return null;
  const filter = {
    teacher,
    periodFrom: { $lte: toDate },
    periodTo:   { $gte: fromDate },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Payment.findOne(filter).populate('teacher', 'firstName lastName email');
}

// GET /api/payments
exports.list = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.role === 'teacher') filter.teacher = req.user._id;
  const payments = await Payment.find(filter)
    .populate('teacher', 'firstName lastName email')
    .sort({ createdAt: -1 });
  res.json(payments);
});

// GET /api/payments/:id
exports.getOne = asyncHandler(async (req, res) => {
  const p = await Payment.findById(req.params.id).populate('teacher');
  if (!p) { res.status(404); throw new Error('Payment not found'); }
  if (req.role === 'teacher' && String(p.teacher._id) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  res.json(p);
});

// POST /api/payments   (admin)
exports.create = asyncHandler(async (req, res) => {
  const { teacher, hoursWorked, hourlyRate, periodFrom, periodTo, notes, breakdown, force } = req.body;
  if (!teacher || hoursWorked == null || hourlyRate == null) {
    res.status(400); throw new Error('teacher, hoursWorked, hourlyRate required');
  }

  // Duplicate guard. Without periodFrom + periodTo we can't check, but the
  // attendance-driven flow always sets them and the manual form should too,
  // so silently skipping is the right behaviour for legacy/manual cases
  // that genuinely lack a period.
  if (periodFrom && periodTo && !force) {
    const conflict = await findOverlappingPayment({
      teacher,
      fromDate: new Date(periodFrom),
      toDate:   new Date(periodTo),
    });
    if (conflict) {
      res.status(409); // Conflict — surfaced clearly to the UI
      const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';
      throw new Error(
        `A payslip already exists for this teacher covering ${fmt(conflict.periodFrom)} → ${fmt(conflict.periodTo)} (€ ${Number(conflict.grossAmount || 0).toFixed(2)}).`
      );
    }
  }

  const grossAmount = Number(hoursWorked) * Number(hourlyRate);
  const payment = await Payment.create({
    teacher, hoursWorked, hourlyRate, grossAmount, periodFrom, periodTo, notes,
    breakdown: Array.isArray(breakdown) ? breakdown : undefined,
    issuedBy: req.user._id,
  });
  res.status(201).json(payment);
});

/**
 * GET /api/payments/preview-from-attendance?teacher=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Looks up the teacher's recorded attendance in the range and returns a
 * day-by-day breakdown ready for the admin to confirm.
 *
 *   {
 *     teacher: { _id, firstName, lastName, hourlyRate },
 *     days: [{ date, hours: [1,2,3] }, ...],
 *     totalHours: 9
 *   }
 *
 * The frontend uses this to render the breakdown table and to pre-fill the
 * rate before the admin clicks "Generate".
 */
exports.previewFromAttendance = asyncHandler(async (req, res) => {
  const { teacher, from, to } = req.query;
  if (!teacher || !from || !to) {
    res.status(400); throw new Error('teacher, from, to required');
  }
  const fromR = dayRange(from);
  const toR = dayRange(to);
  if (!fromR || !toR) { res.status(400); throw new Error('Invalid date'); }
  if (fromR.start > toR.start) {
    res.status(400); throw new Error('"from" must be <= "to"');
  }

  const teacherDoc = await Teacher.findById(teacher).select('firstName lastName email phone hourlyRate');
  if (!teacherDoc) { res.status(404); throw new Error('Teacher not found'); }

  const records = await TeacherAttendance.find({
    teacher,
    date: { $gte: fromR.start, $lt: toR.end },
  }).sort({ date: 1 });

  let totalHours = 0;
  const days = records.map((r) => {
    const hours = r.hours || [];
    totalHours += hours.length;
    return { date: r.date, hours };
  });

  // Heads-up to the UI: if a payslip already covers any part of this
  // range for this teacher, return it so the form can warn before the
  // admin clicks Generate. Doesn't *block* anything here — just informs.
  const conflict = await findOverlappingPayment({
    teacher,
    fromDate: fromR.start,
    toDate:   toR.end,
  });

  res.json({
    teacher: teacherDoc,
    days,
    totalHours,
    conflict: conflict
      ? {
          _id: conflict._id,
          periodFrom: conflict.periodFrom,
          periodTo:   conflict.periodTo,
          grossAmount: conflict.grossAmount,
        }
      : null,
  });
});

// PUT /api/payments/:id   (admin)
exports.update = asyncHandler(async (req, res) => {
  const p = await Payment.findById(req.params.id);
  if (!p) { res.status(404); throw new Error('Payment not found'); }
  Object.assign(p, req.body);
  if (req.body.hoursWorked != null || req.body.hourlyRate != null) {
    p.grossAmount = Number(p.hoursWorked) * Number(p.hourlyRate);
  }

  // Same duplicate guard as create. If the edit changes the teacher or
  // the period, we re-check overlap excluding the current record.
  if (p.periodFrom && p.periodTo && !req.body.force) {
    const conflict = await findOverlappingPayment({
      teacher: p.teacher,
      fromDate: new Date(p.periodFrom),
      toDate:   new Date(p.periodTo),
      excludeId: p._id,
    });
    if (conflict) {
      res.status(409);
      const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';
      throw new Error(
        `A payslip already exists for this teacher covering ${fmt(conflict.periodFrom)} → ${fmt(conflict.periodTo)} (€ ${Number(conflict.grossAmount || 0).toFixed(2)}).`
      );
    }
  }

  // Old PDF (if any) is now stale.
  if (p.pdfPath && fs.existsSync(p.pdfPath)) {
    try { fs.unlinkSync(p.pdfPath); } catch (_) {}
    p.pdfPath = '';
  }
  await p.save();
  res.json(p);
});

// DELETE /api/payments/:id   (admin)
exports.remove = asyncHandler(async (req, res) => {
  const p = await Payment.findByIdAndDelete(req.params.id);
  if (!p) { res.status(404); throw new Error('Payment not found'); }
  if (p.pdfPath && fs.existsSync(p.pdfPath)) {
    try { fs.unlinkSync(p.pdfPath); } catch (_) {}
  }
  res.json({ message: 'Payment removed' });
});

// GET /api/payments/:id/payslip   (admin or owning teacher)
exports.payslip = asyncHandler(async (req, res) => {
  const p = await Payment.findById(req.params.id).populate('teacher');
  if (!p) { res.status(404); throw new Error('Payment not found'); }
  if (req.role === 'teacher' && String(p.teacher._id) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }

  if (!p.pdfPath || !fs.existsSync(p.pdfPath)) {
    p.pdfPath = await generatePayslipPDF(p, p.teacher);
    await p.save();
  }

  res.download(p.pdfPath, `payslip_${p._id}.pdf`);
});
