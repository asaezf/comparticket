// Vercel Serverless entry point — exports the Express app directly.
// Vercel's @vercel/node runtime supports Express apps natively.
const app = require('../server');

module.exports = app;
