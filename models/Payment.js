const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    hoursWorked: { type: Number, required: true, min: 0 },
    hourlyRate: { type: Number, required: true, min: 0 },
    grossAmount: { type: Number, required: true, min: 0 },

    periodFrom: { type: Date },
    periodTo: { type: Date },

    // PDF gets generated lazily — store the file path once produced.
    pdfPath: { type: String, default: '' },

    notes: { type: String, default: '' },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },

    // Optional day-level breakdown when the payment was generated from
    // recorded teacher-attendance. Each entry is one working day:
    //   { date: Date, hours: [1, 2, 3] }
    // If absent, the payment was created the old way (single hoursWorked
    // number) and the payslip falls back to a single-row layout.
    breakdown: {
      type: [{
        date:  { type: Date, required: true },
        hours: { type: [Number], default: [] },
      }],
      default: undefined,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
