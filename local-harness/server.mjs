/**
 * Local harness server. Serves the viewer page + sample PDF, and exposes
 * POST /sign — a faithful stand-in for the ServiceNow Scripted REST API
 * (Nutrient DWS API /sign): it mints a client JWT from api.nutrient.io/tokens
 * using NUTRIENT_DWS_API_TOKEN, scoped to digital_signatures_api + this origin.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8787;

async function loadEnv() {
  try {
    const txt = await readFile(join(__dirname, '..', '.env.local'), 'utf8');
    const env = {};
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch { return {}; }
}

const env = await loadEnv();
const DWS_KEY = env.NUTRIENT_DWS_API_TOKEN || '';
const LICENSE = env.NUTRIENT_WEB_SDK_LICENSE_KEY || '';

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      let html = await readFile(join(__dirname, 'index.html'), 'utf8');
      html = html.replace('__LICENSE_KEY__', JSON.stringify(LICENSE || ''));
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
    if (req.method === 'GET' && req.url === '/viewer.js') {
      return send(res, 200, 'application/javascript', await readFile(join(__dirname, 'viewer.js')));
    }
    if (req.method === 'GET' && req.url.split('?')[0] === '/sample.pdf') {
      return send(res, 200, 'application/pdf', await readFile(join(__dirname, 'sample.pdf')));
    }
    if (req.method === 'POST' && req.url === '/sign') {
      const origin = req.headers.origin || ('http://localhost:' + PORT);
      if (!DWS_KEY) {
        return send(res, 500, 'application/json', JSON.stringify({ success: false, error: 'NUTRIENT_DWS_API_TOKEN not set in .env.local' }));
      }
      const payload = { allowedOperations: ['digital_signatures_api'], allowedOrigins: [origin], expirationTime: 3600 };
      const r = await fetch('https://api.nutrient.io/tokens', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + DWS_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      if (!r.ok) {
        return send(res, 502, 'application/json', JSON.stringify({
          success: false,
          error: 'DWS token mint failed (upstream HTTP ' + r.status + '). Check NUTRIENT_DWS_API_TOKEN in .env.local.',
        }));
      }
      const data = JSON.parse(text);
      return send(res, 200, 'application/json', JSON.stringify({ success: true, accessToken: data.accessToken, id: data.id, expiresIn: 3600 }));
    }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    send(res, 500, 'application/json', JSON.stringify({ success: false, error: String(e) }));
  }
});

server.listen(PORT, () => {
  console.log('Nutrient harness → http://localhost:' + PORT);
  console.log('  license key: ' + (LICENSE ? 'set' : 'NOT set (trial/watermark mode)'));
  console.log('  DWS token:   ' + (DWS_KEY ? 'present (' + DWS_KEY.length + ' chars)' : 'NOT set'));
});
