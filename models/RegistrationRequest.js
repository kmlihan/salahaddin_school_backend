const mongoose = require('mongoose');

/**
 * Address sub-document for a registration request.
 *
 * We deliberately keep this loose at the schema level (no required: true
 * on the inner fields) — required-ness is enforced in the controller so
 * that legacy rows without a complete address still load. New requests
 * created via the public form go through validation that requires every
 * field to be present.
 */
const addressSchema = new mongoose.Schema(
  {
    street:      { type: String, default: '', trim: true },
    houseNumber: { type: String, default: '', trim: true },
    city:        { type: String, default: '', trim: true },
    postalCode:  { type: String, default: '', trim: true },
    country:     { type: String, default: '', trim: true },
  },
  { _id: false }
);

/**
 * A pending sign-up. The public registration form (parent + student
 * fields in one payload) creates one of these. An admin reviews it and
 * either approves (which creates the real Parent + Student documents)
 * or rejects (with an optional reason that goes into the rejection email).
 *
 * The shape of `parent` and `student` mirrors the relevant fields on
 * those models. Passwords are NOT collected here — they're auto-generated
 * on approval using the existing `[firstname][lastname]salahaddin` rule.
 */
const registrationRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    parent: {
      firstName: { type: String, required: true, trim: true },
      lastName:  { type: String, required: true, trim: true },
      email:     { type: String, required: true, trim: true, lowercase: true },
      phone:     { type: String, default: '' },
    },

    student: {
      firstName:      { type: String, required: true, trim: true },
      lastName:       { type: String, required: true, trim: true },
      email:          { type: String, required: true, trim: true, lowercase: true },
      // Level is optional here — the controller fills it from birthDate
      // on submit if the form didn't send one (typical case for ages 6–16).
      level:          { type: String, enum: ['A', 'B', 'C', 'D'], default: 'A' },
      gender:         { type: String, enum: ['male', 'female'], default: 'male' },
      birthDate:      { type: Date,   default: null },
      phone:          { type: String, default: '' },
      emergencyPhone: { type: String, default: '' },
      address:        { type: addressSchema, default: () => ({}) },
    },

    message:         { type: String, default: '' },         // optional note from family
    rejectionReason: { type: String, default: '' },         // set when status='rejected'
    decidedAt:       { type: Date,   default: null },
    decidedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RegistrationRequest', registrationRequestSchema);
