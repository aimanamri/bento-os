'use strict';

// Uniform error envelope: { error: { code, message } } (IMPLEMENTATION-PLAN §3)
function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

module.exports = { sendError };
