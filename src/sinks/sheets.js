import { createSign } from "node:crypto";
import { fetchOk } from "../retry.js";
import { formulaSafe } from "./csv.js";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const base64url = (data) => Buffer.from(data).toString("base64url");

// A Google service account's signed JWT (RS256), swapped for an access token: no googleapis package needed.
export function serviceAccountJwt(account, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? "https://oauth2.googleapis.com/token", iat: nowSeconds, exp: nowSeconds + 3600,
  }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

// Appends each row to the sheet (the service account's client_email must be shared on it as an editor).
export function sheetsSink({ account, spreadsheetId, range = "Orders!A1", fetchImpl = fetch }) {
  let token = null;
  let expires = 0;

  async function accessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (token && now < expires - 60) return token;
    const response = await fetchOk(fetchImpl, account.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountJwt(account, now) }),
    });
    const body = await response.json();
    token = body.access_token;
    expires = now + Number(body.expires_in ?? 3600);
    return token;
  }

  return {
    name: "sheets",
    async write(values) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`
        + "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
      await fetchOk(fetchImpl, url, {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        // (USER_ENTERED runs a cell starting with "=" as a formula; with a leading ' Sheets keeps it as text and hides the ')
        body: JSON.stringify({ values: [values.map((value) => (typeof value === "string" ? formulaSafe(value) : value))] }),
      });
    },
  };
}
