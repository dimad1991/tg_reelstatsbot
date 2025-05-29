import fs from 'fs';
import path from 'path';

const STATS_FILE = path.join(process.cwd(), 'stats.json');
const SECRET_KEY = process.env.STATS_SECRET || 'supersecret';

export function logEvent({ userId, username, query }) {
  const stats = loadStats();
  const timestamp = new Date().toISOString();
  
  stats.push({ userId, username, query, timestamp });

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

export function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return [];
    const data = fs.readFileSync(STATS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

export function renderStatsHtml(stats) {
  const rows = stats.map(s => `
    <tr>
      <td>${s.timestamp}</td>
      <td>${s.userId}</td>
      <td>${s.username || ''}</td>
      <td>${s.query}</td>
    </tr>
  `).join('\n');

  return `
    <html>
    <head>
      <title>Bot Analytics</title>
      <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 8px; }
        th { background: #eee; }
      </style>
    </head>
    <body>
      <h1>Bot Usage Analytics</h1>
      <table>
        <tr><th>Timestamp</th><th>User ID</th><th>Username</th><th>Query</th></tr>
        ${rows}
      </table>
    </body>
    </html>
  `;
}

export function isAuthorizedKey(query) {
  return query.get('key') === SECRET_KEY;
}
