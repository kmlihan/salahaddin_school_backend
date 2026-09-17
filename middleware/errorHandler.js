/**
 * Final error handler. Returns JSON for API clients.
 * Uses the status code already on the response, falling back to 500.
 */
function errorHandler(err, req, res, next) {
  let status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  let message = err.message || 'Server error';

  // Mongoose validation
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  }
  // Duplicate key
  if (err.code === 11000) {
    status = 400;
    message = `Duplicate value: ${Object.keys(err.keyValue || {}).join(', ')}`;
  }

  res.status(status).json({
    message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
}

function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Not found - ${req.originalUrl}`));
}

module.exports = { errorHandler, notFound };
