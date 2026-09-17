const asyncHandler = require('express-async-handler');
const Expense = require('../models/Expense');

exports.list = asyncHandler(async (req, res) => {
  const list = await Expense.find().sort({ date: -1, createdAt: -1 });
  res.json(list);
});

exports.create = asyncHandler(async (req, res) => {
  const expense = await Expense.create({ ...req.body, recordedBy: req.user._id });
  res.status(201).json(expense);
});

exports.update = asyncHandler(async (req, res) => {
  const e = await Expense.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!e) { res.status(404); throw new Error('Expense not found'); }
  res.json(e);
});

exports.remove = asyncHandler(async (req, res) => {
  const e = await Expense.findByIdAndDelete(req.params.id);
  if (!e) { res.status(404); throw new Error('Expense not found'); }
  res.json({ message: 'Expense removed' });
});
