const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'general' }, // 'supplies', 'maintenance', 'other'
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    receiptUrl: { type: String, default: '' },
    status: { type: String, enum: ['needed', 'approved', 'purchased'], default: 'needed' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Expense', expenseSchema);
