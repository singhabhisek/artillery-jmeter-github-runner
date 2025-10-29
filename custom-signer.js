const aws4 = require('aws4');
const url = require('url');

// Define the service and region based on your target URL
const SERVICE_NAME = 'execute-api';
const REGION = 'us-east-2';
// FIX: Hardcode the target host here to avoid reading context.config, which was undefined.
const TARGET_HOST = 'xc2wojfn0c.execute-api.us-east-2.amazonaws.com'; 

/**
 * Custom processor function to sign requests using the aws4 library.
 * This hook replaces the old 'addAmazonSignatureV4' plugin function.
 */
function signRequest(requestParams, context, ee, next) {
  try {
    // ❌ The line below has been replaced by the TARGET_HOST constant above.
    // const targetUrl = new URL(context.config.target); 
    
    // We get the path from the URL configured in the flow (e.g., /prod/secure)
    const requestPath = url.parse(requestParams.url).path; 
    
    // Handle the JSON body correctly for POST requests
    const body = requestParams.json ? JSON.stringify(requestParams.json) : undefined;
    
    // 1. Prepare the signing options
    const options = {
      host: TARGET_HOST, // Using the hardcoded host
      method: requestParams.method || 'GET',
      path: requestPath,
      service: SERVICE_NAME,
      region: REGION,
      headers: requestParams.headers || {},
      body: body,
    };

    // 2. Sign the request (Credentials are automatically read from environment variables)
    const signedRequest = aws4.sign(options);

    // 3. Apply the signed headers back to the requestParams object
    requestParams.headers = signedRequest.headers;

    // IMPORTANT: When using a custom signer, the body must be explicitly set back 
    // on requestParams when using 'json' in the YAML.
    if (body) {
        requestParams.body = body;
    }
    
    return next();
  } catch (error) {
    console.error("SigV4 Signing Error:", error);
    return next(error);
  }
}

module.exports = {
  signRequest
};
