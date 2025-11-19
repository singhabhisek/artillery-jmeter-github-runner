/**
 * ============================================================
 * UNIVERSAL ARTILLERY UTILS + AWS SIGV4 SIGNER (CSV-aware)
 * ============================================================
 * Provides:
 * ✅ AWS Signature V4 signing for API Gateway (optional via tag)
 * ✅ File-based response/error/debug logging
 * ✅ CSV data loading utility
 * ✅ Random data helpers
 * ============================================================
 * * TO USE: Reference this file in your YAML config: 'processor: "./processors.js"'
 */

const fs = require("fs");
const path = require("path");
const aws4 = require("aws4");
const url = require("url");
const { parse } = require("csv-parse/sync");
const { faker } = require("@faker-js/faker");

// -------------------------------
// ENVIRONMENT CONFIG & LOG SETUP
// -------------------------------
const SERVICE_NAME = "execute-api";
const REGION = process.env.AWS_REGION;
const TARGET_HOST = process.env.TARGET_HOST;
const LOG_DIR = path.resolve("./artillery-logs");

// Create logs directory if not present
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Log file paths
const RESPONSE_LOG = path.join(LOG_DIR, "responses.log");
const ERROR_LOG = path.join(LOG_DIR, "errors.log");
const DEBUG_LOG = path.join(LOG_DIR, "debug.log");

// Flags read from environment variables to control logging verbosity
const DEBUG_LOG_BODY_ENABLED = process.env.DEBUG_LOG_BODY === "true"; 
const RESPONSE_LOG_BODY_ENABLED = process.env.RESPONSE_LOG_BODY_ENABLED === "true"; 

console.log(process.env.APP_AWS_KEY);
console.log(process.env.APP_AWS_SECRET);
console.log(process.env.AWS_REGION);

// -------------------------------
// Helper: Append line to a log file
// -------------------------------
function logToFile(file, message) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(file, `[${timestamp}] ${message}\n`);
}

// -------------------------------
// UTILITY FUNCTIONS (Called via 'function' in YAML)
// -------------------------------

/**
 * UTILITY: Generates a random number of a specified length.
 * @param {number} length - The desired number length (default 6).
 * * HOW TO CALL IN YAML:
 * - set:
 * id: '{{ $randomNumber(8) }}'
 */
function randomNumber(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min));
}

/**
 * UTILITY: Generates a random date string (YYYY-MM-DD) between two years.
 * @param {number} startYear - Start year.
 * @param {number} endYear - End year.
 * * HOW TO CALL IN YAML:
 * - set:
 * date: '{{ $randomDate(2020, 2024) }}'
 */
function randomDate(startYear = 2000, endYear = 2025) {
    const start = new Date(startYear, 0, 1);
    const end = new Date(endYear, 11, 31);
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return date.toISOString().split("T")[0];
}

/**
 * UTILITY: Loads CSV data from a file path.
 * @param {string} filePath - Path to the CSV file.
 * @returns {Array} Array of objects where keys are CSV headers.
 * * HOW TO CALL IN YAML (to set CSV data source):
 * config:
 * phases: [...]
 * variables:
 * users:
 * function: 'loadCsvData'
 * params: ['./data/users.csv']
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
// ARTILLERY HOOKS (Called via 'beforeRequest'/'afterResponse'/etc. in YAML)
// -------------------------------

/**
 * BEFORE REQUEST HOOK: Signs the outgoing request with AWS Signature V4.
 * Uses environment variables for credentials (APP_AWS_KEY, APP_AWS_SECRET, etc.).
 * * WHEN TO CALL IN YAML:
 * - post:
 * url: "/path"
 * beforeRequest: "signRequest"
 */

// const url = require("url");
// NOTE: Assuming aws4, TARGET_HOST, REGION, and DEBUG_LOG are defined/imported.

/**
 * UTILITY: Resolves Artillery template variables in a string.
 */

// NOTE: Assuming aws4, TARGET_HOST, REGION, and DEBUG_LOG are defined/imported.

/**
 * UTILITY: Resolves Artillery template variables in a string.
 */
function resolveTemplate(str, vars) {
    if (!str || typeof str !== "string") return str;

    return str.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
        return vars[key.trim()] !== undefined ? String(vars[key.trim()]) : "";
    });
}

/**
 * BEFORE REQUEST HOOK: Signs the outgoing request with AWS Signature V4.
 */
function signRequest(requestParams, context, ee, next) {
    try {
        // 1. Path Preparation (required for both GET and POST)
        let resolvedUrl = resolveTemplate(requestParams.url, context.vars);
        const parsedUrl = url.parse(resolvedUrl);
        const canonicalPath = parsedUrl.pathname + (parsedUrl.search || '');

        // 2. Body Preparation (CRITICAL FOR POST)
        let body;
        if (requestParams.json) {
            
            // --- FIX IS HERE: Manually resolve variables in the JSON body ---
            const jsonBodyString = JSON.stringify(requestParams.json);
            
            // Resolve variables in the stringified JSON payload
            body = resolveTemplate(jsonBodyString, context.vars); 
            
            // Re-set the request body for the HTTP client (using the resolved string)
            requestParams.body = body; 
            
            // Delete the 'json' property as the stringified 'body' is now present
            delete requestParams.json; 
        } 
        
        // (Optional Debugging Log - CHECK 1: The correct body is signed)
        if (body) {
            logToFile(DEBUG_LOG, `POST Body Signed Content: ${body.substring(0, 100)}`);
        }
        
        // 3. Build canonical signing opts
        const opts = {
            host: TARGET_HOST, 
            method: requestParams.method,
            path: canonicalPath, 
            service: SERVICE_NAME,
            region: REGION,
            body: body,
            headers: {
                ...requestParams.headers,
                'Host': TARGET_HOST, // Ensure Host is signed
            },
        };
        
        // 4. Sign
        const creds = {
            accessKeyId: process.env.APP_AWS_KEY,
            secretAccessKey: process.env.APP_AWS_SECRET,
            sessionToken: process.env.APP_AWS_SESSION || undefined
        };
        const signed = aws4.sign(opts, creds);

        // 5. Apply Headers and final URL
        requestParams.url = canonicalPath;
        requestParams.headers = signed.headers;

        return next();
    } catch (err) {
        console.error("SIGN ERROR:", err);
        return next(err);
    }
}

/**
 * AFTER RESPONSE HOOK: Logs responses (2xx/3xx to success log, 4xx/5xx to error log).
 * Includes status code, URL, response snippet, and request body on error (if enabled).
 * * WHEN TO CALL IN YAML:
 * - get:
 * url: "/status"
 * afterResponse: "afterResponse"
 */
function afterResponse(requestParams, response, context, ee, next) {
    const requestUrl = `${requestParams.method} ${requestParams.url}`;
    
    // --- Determine Response Body ---
    let responseBodyText = "<no response body>";
    if (response && response.body) {
        // Converts response body (buffer, string, or object) to string
        responseBodyText = Buffer.isBuffer(response.body)
            ? response.body.toString("utf-8")
            : typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body, null, 2);
    }

    // --- Determine Request Body ---
    let requestBodyText = "<no request body>";
    if (requestParams.body) {
        // Converts request body (string or object) to string
        requestBodyText = typeof requestParams.body === "string"
            ? requestParams.body
            : JSON.stringify(requestParams.body, null, 2);
    }

    // --- Handle No Response (Connection Error) ---
    if (!response) {
        let errorMsg = `No response received for ${requestUrl}.`;
        if (DEBUG_LOG_BODY_ENABLED) {
            errorMsg += ` Request Body: ${requestBodyText.substring(0, 500)}${requestBodyText.length > 500 ? "..." : ""}`;
        }
        console.log(`⚠️ ${errorMsg}`);
        logToFile(ERROR_LOG, errorMsg);
        return next();
    }

    const statusCode = response.statusCode;
    
    // Create base log message with response details
    let logMessage = `${statusCode} ${requestUrl} | Response Snippet: ${responseBodyText.substring(0, 500)}${responseBodyText.length > 500 ? "..." : ""}`;

    // --- Log based on status code ---
    if (statusCode >= 400) {
        // 4xx or 5xx are errors: conditionally append request body to log
        if (DEBUG_LOG_BODY_ENABLED) {
            logMessage += `\nREQUEST BODY: ${requestBodyText.substring(0, 500)}${requestBodyText.length > 500 ? "..." : ""}`;
            console.log(`❌ ERROR ${statusCode} for ${requestUrl}`);
            console.log(`Request Body (first 500 chars): ${requestBodyText.substring(0, 500)}`);
        }

        // Log the error message to the error file (if response body logging is enabled)
        if (RESPONSE_LOG_BODY_ENABLED) {
            logToFile(ERROR_LOG, logMessage);
        }
        
    } else if (statusCode >= 200 && statusCode < 400 && RESPONSE_LOG_BODY_ENABLED) {
        // 2xx or 3xx are successes/redirections
        logToFile(RESPONSE_LOG, logMessage);
        
    } else {
        // Log other status codes (e.g., 1xx)
        if (RESPONSE_LOG_BODY_ENABLED) logToFile(DEBUG_LOG, `[Other Status] ${logMessage}`);
    }

    return next();
}

/**
 * AFTER RESPONSE HOOK: Captures errors (status >= 400) and logs the status code and message.
 * @param {Object} req - The request parameters object.
 * @param {Object} res - The response object.
 * @param {Object} context - The Artillery context.
 * @param {Object} events - The events emitter.
 * @param {function} done - Callback to proceed to the next request.
 * WHEN TO CALL IN YAML: Use with 'afterResponse' hook in flow:
 * - get:
 * url: "/path"
 * afterResponse: "captureErrors"
 */
function captureErrors(req, res, context, events, done) {
    // Check if the status message property exists, otherwise use a placeholder.
    const statusMessage = res.statusMessage || 'Unknown Status Message'; 

    if (res.statusCode >= 400) {
        console.error(`❌ Request failed: ${req.url} - ${res.statusCode} ${statusMessage}`);
    }
    return done();
}

/**
 * UTILITY: Generates a random email using faker.
 * * HOW TO CALL IN YAML:
 * - set:
 * email: '{{ $randomEmail() }}'
 */
function randomEmail() {
    return faker.internet.email();
}



/**
 * UTILITY: Generates a random UUID string using faker.
 * * HOW TO CALL IN YAML:
 * - set:
 * id: '{{ $randomUuid() }}'
 */
function randomUuid() {
    return faker.string.uuid();
}

/**
 * UTILITY: Generates random lorem text.
 * @param {number} wordCount - Number of words to generate.
 * * HOW TO CALL IN YAML:
 * - set:
 * note: '{{ $randomText(50) }}'
 */
function randomText(wordCount = 10) {
    return faker.lorem.words(wordCount);
}

/**
 * PROCESSOR: Generates multiple random variables and adds them to context.vars.
 * * WHEN TO CALL IN YAML:
 * - post:
 * url: "/api/create"
 * beforeRequest: "generateRandoms"
 * OR
 * - function: "generateRandoms"
 */
function generateRandoms(context, events, done) {
    context.vars.randomWord = faker.word.sample();
    context.vars.randomUuid = faker.string.uuid();
    context.vars.randomEmail = faker.internet.email();
    context.vars.uniqueEmail = uniqueFakerEmail();
    context.vars.randomText = randomText();
    done();
}

/**
 * AFTER RESPONSE HOOK: Custom assertion/validation on the response body.
 * Fails the request if the expected data is missing (e.g., missing 'id').
 * * WHEN TO CALL IN YAML:
 * - post:
 * url: "/create"
 * afterResponse: "validateResponseData"
 */
function validateResponseData(requestParams, response, context, ee, next) {
    try {
        const body = JSON.parse(response.body);
        if (!body.id) {
            throw new Error('Response is missing the required ID field.');
        }
        return next();
    } catch (e) {
        // Return error to Artillery to mark request as failed
        return next(new Error(`Validation failed for ${requestParams.url}: ${e.message}`));
    }
}

/**
 * UTILITY: Generates a unique email address using faker and a timestamp tag.
 * * HOW TO CALL IN YAML:
 * - set:
 * uniqueUserEmail: '{{ $uniqueFakerEmail() }}'
 */
function uniqueFakerEmail() {
    const date = new Date();
    // Creates a unique tag based on current time (day, minute, second, millisecond)
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    
    const baseUser = faker.internet.username();
    const uniqueTag = `${dd}${mm}${ss}${ms}`;
    const domain = faker.internet.domainName();
    
    return `${baseUser}.${uniqueTag}@${domain}`;
}


// -------------------------------
// GENERIC CONTEXT LOGGING UTILITIES (Internal use by customLog)
// -------------------------------

/**
 * INTERNAL UTILITY: Formats all variables currently in context.vars into a single log string.
 * @param {Object} contextVars - The context.vars object from Artillery.
 * @returns {string} Formatted string of all key-value pairs.
 */
function formatAllContextVars(contextVars = {}) {
    if (Object.keys(contextVars).length === 0) {
        return '[No Context Vars Found]';
    }

    const detailsArray = Object.entries(contextVars).map(([key, value]) => {
        const formattedValue = typeof value === 'object' && value !== null
            ? JSON.stringify(value) // Stringify objects/arrays
            : value;
        return `${key}: ${formattedValue}`;
    });

    return `[Context Vars: ${detailsArray.join(', ')}]`;
}

/**
 * UTILITY: Custom logging function to log messages with all context variables and request body snippet.
 * Note: This function is primarily designed to be called by other processors/hooks, but is exported.
 * * HOW TO CALL IN ANOTHER PROCESSOR/HOOK (e.g., inside a custom validation):
 * customLog('ERROR', 'Custom Validation Failed!', context.vars);
 */
function customLog(type, message, contextVars = {}, requestBodySnippet = '<N/A>') {
    
    const contextDetails = formatAllContextVars(contextVars);
    let logLine = `[${type}] ${contextDetails} | ${message}`;
    
    if (type === 'ERROR' && requestBodySnippet !== '<N/A>') {
        logLine += `\n\tREQUEST BODY: ${requestBodySnippet}`;
    }

    console.log(logLine); 
    // Uncomment the line below and manage which log file to write to:
    // logToFile(ERROR_LOG, logLine);
}


// -------------------------------
// EXPORTS: Functions available to be called in your YAML file
// -------------------------------
module.exports = {
    // Artillery Hooks
    signRequest,        // Use with 'beforeRequest' to sign AWS requests
    afterResponse,      // Use with 'afterResponse' for universal logging/error handling
    validateResponseData, // Use with 'afterResponse' for custom validation
    generateRandoms,    // Use with 'beforeRequest' or 'function' to set variables

    // Utility Functions
    loadCsvData,        // Use with 'config.variables' to load CSV data
    randomNumber,       // Use with 'set' helper: '{{ $randomNumber(N) }}'
    randomDate,         // Use with 'set' helper: '{{ $randomDate(Y1, Y2) }}'
    randomEmail,        // Use with 'set' helper: '{{ $randomEmail() }}'
    randomUuid,         // Use with 'set' helper: '{{ $randomUuid() }}'
    randomText,         // Use with 'set' helper: '{{ $randomText(N) }}'
    uniqueFakerEmail,   // Use with 'set' helper: '{{ $uniqueFakerEmail() }}'
    
    // Custom Logger (if needed within another custom processor)
    customLog,
	captureErrors //Simple error capture
};

// // -------------------------------
// // AWS SigV4 Signing Hook
// // -------------------------------
// function signRequest(requestParams, context, ee, next) {
//   try {
//     // Only sign if the YAML tag requiresAwsSigV4=true
//     if (!requestParams.tags || !requestParams.tags.includes("requiresAwsSigV4")) {
//       return next();
//     }

//    // const requestPath = url.parse(requestParams.url).path;
//    // const body = requestParams.json ? JSON.stringify(requestParams.json) : undefined;

//     const options = {
//       host: TARGET_HOST,
//       method: requestParams.method || "GET",
//       path: requestPath,
//       service: SERVICE_NAME,
//       region: REGION,
//       headers: requestParams.headers || {},
//       body: body,
//     };

//     // Use generic AWS credentials from environment
//     const awsCreds = {
//       accessKeyId: process.env.APP_AWS_KEY,
//       secretAccessKey: process.env.APP_AWS_SECRET,
//       sessionToken: process.env.APP_AWS_SESSION || undefined,
//     };

//     const signed = aws4.sign(options, awsCreds);
//     requestParams.headers = signed.headers;
//     if (body) requestParams.body = body;

//     logToFile(
//       DEBUG_LOG,
//       `Signed ${options.method} ${options.path} for ${TARGET_HOST} (${REGION})`
//     );
//     return next();
//   } catch (err) {
//     logToFile(ERROR_LOG, `SigV4 Signing Failed: ${err.message}`);
//     return next(err);
//   }
// }

