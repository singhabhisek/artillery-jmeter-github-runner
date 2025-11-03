/**
 * ============================================================
 * UNIVERSAL ARTILLERY UTILS + AWS SIGV4 SIGNER (CSV-aware)
 * ============================================================
 * Provides:
 *   ✅ AWS Signature V4 signing for API Gateway
 *   ✅ File-based response/error/debug logging
 *   ✅ CSV data loading utility
 *   ✅ Random data helpers
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const aws4 = require("aws4");
const url = require("url");
const { parse } = require("csv-parse/sync");
const { faker } = require("@faker-js/faker");

// -------------------------------
// ENVIRONMENT CONFIG
// -------------------------------
const SERVICE_NAME = "execute-api";
const REGION = process.env.AWS_REGION;
const TARGET_HOST = process.env.TARGET_HOST;
const LOG_DIR = path.resolve("./artillery-logs");

// Create logs directory if not present
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Common log files
const RESPONSE_LOG = path.join(LOG_DIR, "responses.log");
const ERROR_LOG = path.join(LOG_DIR, "errors.log");
const DEBUG_LOG = path.join(LOG_DIR, "debug.log");

// -------------------------------
// Helper: Append line to a log file
// -------------------------------
function logToFile(file, message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(file, `[${timestamp}] ${message}\n`);
}

// -------------------------------
// Utility Functions
// -------------------------------

/** Generate random number with specific length */
function randomNumber(length = 6) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(min + Math.random() * (max - min));
}

/** Generate random date between two years (YYYY-MM-DD) */
function randomDate(startYear = 2000, endYear = 2025) {
  const start = new Date(startYear, 0, 1);
  const end = new Date(endYear, 11, 31);
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().split("T")[0];
}

/**
 * Load CSV data file (synchronously for small files)
 * @param {string} filePath - path to CSV (relative to Artillery YAML)
 * @returns {Array<Object>}
 */
function loadCsvData(filePath) {
  try {
    const csvContent = fs.readFileSync(filePath, "utf8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
    logToFile(DEBUG_LOG, `Loaded ${records.length} records from CSV: ${filePath}`);
    return records;
  } catch (err) {
    logToFile(ERROR_LOG, `CSV Load Failed for ${filePath}: ${err.message}`);
    return [];
  }
}

// -------------------------------
// AWS SigV4 Signing Hook
// -------------------------------
function signRequest(requestParams, context, ee, next) {
  try {
    const requestPath = url.parse(requestParams.url).path;
    const body = requestParams.json ? JSON.stringify(requestParams.json) : undefined;

    const options = {
      host: TARGET_HOST,
      method: requestParams.method || "GET",
      path: requestPath,
      service: SERVICE_NAME,
      region: REGION,
      headers: requestParams.headers || {},
      body: body,
    };

    const signed = aws4.sign(options);
    requestParams.headers = signed.headers;
    if (body) requestParams.body = body;

    logToFile(DEBUG_LOG, `Signed ${options.method} ${options.path} for ${TARGET_HOST} (${REGION})`);
    return next();
  } catch (err) {
    logToFile(ERROR_LOG, `SigV4 Signing Failed: ${err.message}`);
    return next(err);
  }
}

// -------------------------------
// Response Hook: Log Success & Failures
// -------------------------------
function afterResponse(requestParams, response, context, ee, next) {
  console.log(`\n--- afterResponse called for ${requestParams.method} ${requestParams.url} ---`);

  if (!response) {
    console.log("⚠️ No response received");
    return next();
  }

  console.log("Status:", response.statusCode);
  console.log("Headers:", response.headers);

  let bodyText;
  if (response.body) {
    bodyText = Buffer.isBuffer(response.body)
      ? response.body.toString("utf-8")
      : typeof response.body === "string"
      ? response.body
      : JSON.stringify(response.body, null, 2);
  } else {
    bodyText = "<no body>";
  }

  console.log("Body:", bodyText);

  return next();
}

// -------------------------------
// Exported for use in YAML
// -------------------------------
module.exports = {
  signRequest,
  afterResponse,
  loadCsvData,
  randomNumber,
  randomDate,
};
