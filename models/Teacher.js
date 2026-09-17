const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teacherSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, default: '' },
    photo: { type: String, default: '' },
    role: { type: String, default: 'teacher', immutable: true },
    hourlyRate: { type: Number, default: 0 }, // used for payslip generation
    // Password reset
    resetTokenHash: { type: String, default: '' },
    resetTokenExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

teacherSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

teacherSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('Teacher', teacherSchema);
