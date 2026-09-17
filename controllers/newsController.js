const asyncHandler = require('express-async-handler');
const News = require('../models/News');

// Public
exports.list = asyncHandler(async (req, res) => {
  const news = await News.find({ published: true }).sort({ createdAt: -1 });
  res.json(news);
});

exports.getOne = asyncHandler(async (req, res) => {
  const item = await News.findById(req.params.id);
  if (!item) { res.status(404); throw new Error('News not found'); }
  res.json(item);
});

// Admin
exports.create = asyncHandler(async (req, res) => {
  const item = await News.create({ ...req.body, author: req.user._id });
  res.status(201).json(item);
});

exports.update = asyncHandler(async (req, res) => {
  const item = await News.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!item) { res.status(404); throw new Error('News not found'); }
  res.json(item);
});

exports.remove = asyncHandler(async (req, res) => {
  const item = await News.findByIdAndDelete(req.params.id);
  if (!item) { res.status(404); throw new Error('News not found'); }
  res.json({ message: 'News removed' });
});
