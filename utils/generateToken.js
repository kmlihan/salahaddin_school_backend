const jwt = require('jsonwebtoken');

/**
 * Generate a signed JWT for a user. We embed `id` and `role` so middleware
 * can route the verify-step to the correct collection without a DB lookup.
 */
function generateToken(id, role) {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

module.exports = generateToken;
