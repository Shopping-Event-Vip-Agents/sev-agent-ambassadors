import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env files in priority order
const __dirname = dirname(fileURLToPath(import.meta.url));
const envFiles = [
  resolve(__dirname, '../.env'),                          // sev-agent-ambassadors/.env
  resolve(__dirname, '../../sev-agent-seo/.env'),         // sev-agent-seo/.env (has full JSON key)
  resolve(__dirname, '../../sev-ai-core/.env'),           // sev-ai-core/.env
];
for (const f of envFiles) {
  config({ path: f });
}

const ROOT_FOLDER_ID = '1ACZFVZuGYYmG2hxznHKIombq3TyqqDS-';
const IMPERSONATE_EMAIL = 'domien@shoppingeventvip.be';
const MAX_DEPTH = 3;

// ── Auth ────────────────────────────────────────────────────
function getCredentials() {
  // Try base64-encoded key first
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (b64 && b64.length > 50) {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  }
  // Try raw JSON key
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (raw && raw.startsWith('{')) {
    return JSON.parse(raw);
  }
  throw new Error('No Google service account key found in env vars');
}

const creds = getCredentials();
console.log(`Using service account: ${creds.client_email}`);

const auth = new google.auth.JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'],
  subject: IMPERSONATE_EMAIL,
});

const drive = google.drive({ version: 'v3', auth });

// ── Drive helpers ───────────────────────────────────────────
async function listChildren(folderId) {
  const items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime)',
      pageSize: 1000,
      pageToken,
      orderBy: 'name',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    items.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

function formatSize(bytes) {
  if (!bytes) return '-';
  const n = parseInt(bytes, 10);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortMime(mime) {
  if (!mime) return '?';
  if (mime === 'application/vnd.google-apps.folder') return 'folder';
  if (mime === 'application/vnd.google-apps.document') return 'gdoc';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'gsheet';
  if (mime === 'application/vnd.google-apps.presentation') return 'gslides';
  if (mime === 'application/vnd.google-apps.shortcut') return 'shortcut';
  if (mime.startsWith('image/')) return mime.replace('image/', 'img/');
  if (mime.startsWith('video/')) return mime.replace('video/', 'vid/');
  if (mime.startsWith('audio/')) return mime.replace('audio/', 'aud/');
  if (mime === 'application/pdf') return 'pdf';
  return mime.split('/').pop();
}

// ── Recursive scan ──────────────────────────────────────────
async function scanFolder(folderId, folderName, depth, prefix) {
  const items = await listChildren(folderId);
  const folders = items.filter(i => i.mimeType === 'application/vnd.google-apps.folder');
  const files = items.filter(i => i.mimeType !== 'application/vnd.google-apps.folder');

  // Print files in this folder
  for (const f of files) {
    console.log(`${prefix}├── ${f.name}  [${shortMime(f.mimeType)}, ${formatSize(f.size)}]`);
  }

  // Recurse into subfolders
  for (let i = 0; i < folders.length; i++) {
    const sub = folders[i];
    const isLast = i === folders.length - 1 && files.length === 0;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    console.log(`${prefix}${connector}📁 ${sub.name}/`);

    if (depth < MAX_DEPTH) {
      await scanFolder(sub.id, sub.name, depth + 1, childPrefix);
    } else {
      console.log(`${childPrefix}└── (max depth reached)`);
    }
  }

  return { folderCount: folders.length, fileCount: files.length };
}

// ── Main ────────────────────────────────────────────────────
console.log(`\nScanning Google Drive folder: ${ROOT_FOLDER_ID}`);
console.log(`Impersonating: ${IMPERSONATE_EMAIL}`);
console.log(`Max depth: ${MAX_DEPTH}\n`);

// Get root folder name
const rootMeta = await drive.files.get({ fileId: ROOT_FOLDER_ID, fields: 'name', supportsAllDrives: true });
console.log(`📁 ${rootMeta.data.name}/`);

await scanFolder(ROOT_FOLDER_ID, rootMeta.data.name, 1, '  ');

console.log('\n✅ Scan complete.');
