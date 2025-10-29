'use strict';
const fs = require('fs');
const path = require('path');

// Define a log file path
const logFile = path.join(__dirname, 'responses.log');

module.exports = {
  captureErrors: function (requestParams, response, context, ee, next) {
    const statusCode = response.statusCode;
    const responseBody = response.body;  // full response JSON as string

    // Only log if status code is NOT 2XX
    if (statusCode < 200 || statusCode >= 300) {
      console.log(`Non-2XX response detected: URL: ${requestParams.url}, Status: ${statusCode}, Body: ${responseBody}`);
      
      // Append to file
      const logEntry = `[${new Date().toISOString()}] URL: ${requestParams.url}, Status: ${statusCode}, Body: ${responseBody}\n`;
      fs.appendFileSync(logFile, logEntry);
    }

    return next(); // continue scenario
  }
};
