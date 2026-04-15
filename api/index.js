// Vercel Serverless entry point — wraps the Express app.
const serverless = require('serverless-http');
const app = require('../server');

module.exports = serverless(app);
