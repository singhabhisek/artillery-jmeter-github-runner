const { SignatureV4 } = require("@aws-sdk/signature-v4");
const { Sha256 } = require("@aws-crypto/sha256-js");

// ---------------------------
// IAM credentials
// ---------------------------
const credentials = {
  accessKeyId: "YOUR_ACCESS_KEY",
  secretAccessKey: "YOUR_SECRET_KEY",
  sessionToken: undefined
};

// ---------------------------
// Random POST payload generator
// ---------------------------
function generateRandomPayload() {
  const names = ["Alice", "Bob", "Charlie", "Diana"];
  const cities = ["Seattle", "New York", "London", "Tokyo"];
  return {
    name: names[Math.floor(Math.random() * names.length)],
    age: Math.floor(Math.random() * 60) + 18,
    city: cities[Math.floor(Math.random() * cities.length)]
  };
}

// ---------------------------
// Processor exports
// ---------------------------
module.exports = {
  generateRandomPayload,

  beforeRequest: async (requestParams, context, ee, next) => {
    // Convert JSON body to string for signing
    let bodyString = null;
    if (requestParams.json) bodyString = JSON.stringify(requestParams.json);
    else if (requestParams.body) bodyString = requestParams.body;

    // AWS SigV4 signer
    const signer = new SignatureV4({
      credentials,
      region: "us-east-2",
      service: "execute-api",
      sha256: Sha256
    });

    // Correct path for signing: only resource path (no stage)
    const pathForSigning = requestParams.url;

    const signedRequest = await signer.sign({
      method: requestParams.method,
      protocol: "https:",
      hostname: "xc2wojfn0c.execute-api.us-east-2.amazonaws.com",
      path: pathForSigning,
      headers: requestParams.headers,
      body: bodyString
    });

    // Replace headers and body with signed values
    requestParams.headers = signedRequest.headers;
    if (signedRequest.body) requestParams.body = signedRequest.body;
    delete requestParams.json;

    // Debug: print signed request
    console.log("\nSigned Request:");
    console.log({
      method: requestParams.method,
      url: requestParams.url,
      headers: requestParams.headers,
      body: requestParams.body
    });

    return next();
  },

  afterResponse: (requestParams, response, context, ee, next) => {
    // Print full response for debugging
    console.log(`\nResponse from ${requestParams.method} ${requestParams.url}:`);
    console.log("Status:", response.statusCode);
    console.log("Headers:", response.headers);

    if (response.body) {
      try {
        const text = response.body.toString(); // buffer → string
        console.log(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        console.log(response.body.toString()); // fallback for non-JSON
      }
    } else {
      console.log("No response body returned.");
    }

    return next();
  }
};
