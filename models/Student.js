const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Address sub-document. All fields required when present, but the parent
 * schema controls overall requiredness (not at this level so legacy
 * documents without an address don't fail validation on save).
 */
const addressSchema = new mongoose.Schema(
  {
    street:      { type: String, trim: true, default: '' },
    houseNumber: { type: String, trim: true, default: '' },
    city:        { type: String, trim: true, default: '' },
    postalCode:  { type: String, trim: true, default: '' },
    country:     { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/**
 * One link from a student to a parent, with the relationship type
 * (mother / father / guardian / other). Multiple parents per student
 * is now the norm — both parents have full permissions when querying
 * for "their child".
 */
const parentLinkSchema = new mongoose.Schema(
  {
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true },
    relationship: {
      type: String,
      enum: ['mother', 'father', 'guardian', 'other'],
      required: true,
      default: 'guardian',
    },
  },
  { _id: false }
);

const studentSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    lastName:  { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    email: {
      type: String, required: true, unique: true, lowercase: true, trim: true,
      // Strict-but-pragmatic email regex; the controller does additional
      // duplicate-check logic.
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'],
    },
    password: { type: String, required: true, minlength: 6 },
    photo:    { type: String, default: '' },

    /**
     * Multi-parent. Both/all entries get full access to the child via the
     * parent endpoints. Order is informational; no "primary" concept.
     */
    parents: { type: [parentLinkSchema], default: [] },
    /**
     * Legacy single-parent ref. Kept and auto-synced to parents[0].parent
     * on save so that older queries (`Student.find({ parent: id })`)
     * continue to work while we migrate. New code should query against
     * `parents.parent`.
     */
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' },

    /**
     * Levels:
     *   A — ages 6–12 (default if birthDate set and age in range)
     *   B — ages 13–16 (default if birthDate set and age in range)
     *   C — student who can read Arabic (skill-based, manual)
     *   D — student who can read the Quran (skill-based, manual)
     */
    level:  { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
    gender: { type: String, enum: ['male', 'female'], default: 'male' },

    paidAmount: { type: Number, default: 0 },

    birthDate: { type: Date, default: null },

    /**
     * Student's own phone (optional) and a required emergency contact.
     * Both stored in E.164 (+...).
     */
    phone:          { type: String, default: '' },
    emergencyPhone: { type: String, default: '' },

    address: { type: addressSchema, default: () => ({}) },

    role: { type: String, default: 'student', immutable: true },

    completedUnits: [{ type: mongoose.Schema.Types.ObjectId }],
    viewedLessons:  [{ type: mongoose.Schema.Types.ObjectId }],

    resetTokenHash:    { type: String, default: '' },
    resetTokenExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

studentSchema.pre('save', async function (next) {
  // Hash password on change
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  // Keep legacy `parent` field in sync with the first entry of parents[]
  // so existing queries that reference student.parent keep working until
  // every call site is migrated.
  if (Array.isArray(this.parents) && this.parents.length > 0) {
    this.parent = this.parents[0].parent;
  }
  next();
});

studentSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

/**
 * Compute age in whole years given a birth date. Returns null if the
 * input isn't a valid date.
 */
function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

/**
 * Default level inferred from a birth date. Returns 'A' / 'B' / null.
 * C and D are skill-based and never auto-assigned.
 */
function levelFromBirthDate(birthDate) {
  const age = ageFromBirthDate(birthDate);
  if (age == null) return null;
  if (age >= 6 && age <= 12) return 'A';
  if (age >= 13 && age <= 16) return 'B';
  return null;
}

module.exports = mongoose.model('Student', studentSchema);
module.exports.ageFromBirthDate = ageFromBirthDate;
module.exports.levelFromBirthDate = levelFromBirthDate;
