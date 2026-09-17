const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');

const Admin = require('../models/Admin');
const Teacher = require('../models/Teacher');
const Parent = require('../models/Parent');
const Student = require('../models/Student');

const MODEL_BY_ROLE = {
  admin: Admin,
  teacher: Teacher,
  parent: Parent,
  student: Student,
};

/**
 * Verify JWT and load the correct user document. Sets:
 *   req.user  -> the user document (without password)
 *   req.role  -> 'admin' | 'teacher' | 'parent' | 'student'
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) token = auth.split(' ')[1];

  if (!token) {
    res.status(401);
    throw new Error('Not authorised, no token');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    res.status(401);
    throw new Error('Not authorised, token invalid');
  }

  const Model = MODEL_BY_ROLE[decoded.role];
  if (!Model) {
    res.status(401);
    throw new Error('Not authorised, unknown role');
  }

  const user = await Model.findById(decoded.id).select('-password');
  if (!user) {
    res.status(401);
    throw new Error('Not authorised, user not found');
  }

  req.user = user;
  req.role = decoded.role;
  next();
});

/**
 * Role gate. Pass any number of allowed roles.
 *   router.get('/x', protect, allow('admin', 'teacher'), handler)
 */
const allow = (...roles) => (req, res, next) => {
  if (!roles.includes(req.role)) {
    res.status(403);
    return next(new Error(`Forbidden — requires role: ${roles.join(', ')}`));
  }
  next();
};

module.exports = { protect, allow };
