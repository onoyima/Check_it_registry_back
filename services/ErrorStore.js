const MAX_ERRORS = 100;

class ErrorStore {
  constructor() {
    this.errors = [];
    this.blockedIps = new Map();
    this.startTime = new Date();
  }

  capture(error, req = null) {
    const entry = {
      id: this.errors.length + 1,
      message: error.message || String(error),
      stack: error.stack || null,
      timestamp: new Date().toISOString(),
      method: req?.method || null,
      path: req?.path || req?.originalUrl || null,
      ip: req?.ip || req?.headers?.['x-forwarded-for'] || null,
      userAgent: req?.headers?.['user-agent'] || null,
      statusCode: error.status || error.statusCode || 500,
    };
    this.errors.unshift(entry);
    if (this.errors.length > MAX_ERRORS) this.errors.pop();
    console.error(`[ErrorStore] #${entry.id} ${entry.statusCode} ${entry.method} ${entry.path}: ${entry.message}`);
    return entry;
  }

  blockIp(ip, reason) {
    if (!ip) return;
    const existing = this.blockedIps.get(ip);
    if (existing) {
      existing.count++;
      existing.lastSeen = new Date().toISOString();
    } else {
      this.blockedIps.set(ip, {
        ip,
        reason: reason || 'Blocked by security policy',
        count: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }
  }

  getErrors(limit = 50) {
    return this.errors.slice(0, limit);
  }

  getBlockedIps() {
    return Array.from(this.blockedIps.values());
  }

  getStatus() {
    return {
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      startTime: this.startTime.toISOString(),
      totalErrors: this.errors.length,
      blockedIpCount: this.blockedIps.size,
      recentErrors: this.errors.slice(0, 5),
    };
  }

  renderLandingPage(req) {
    const status = this.getStatus();
    const errors = this.getErrors(30);
    const blockedIps = this.getBlockedIps();

    const formatTime = (ts) => {
      const d = new Date(ts);
      return d.toLocaleString();
    };

    const errorRows = errors.length
      ? errors.map(e => `
        <tr>
          <td>#${e.id}</td>
          <td>${e.statusCode}</td>
          <td>${e.method || '-'}</td>
          <td>${e.path || '-'}</td>
          <td style="max-width:300px;word-break:break-word;">${this._escape(e.message)}</td>
          <td>${e.ip || '-'}</td>
          <td title="${this._escape(e.stack || '')}">${formatTime(e.timestamp)}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center;color:#6b7280;">No errors captured yet</td></tr>';

    const ipRows = blockedIps.length
      ? blockedIps.map(b => `
        <tr>
          <td>${this._escape(b.ip)}</td>
          <td>${this._escape(b.reason)}</td>
          <td>${b.count}</td>
          <td>${formatTime(b.firstSeen)}</td>
          <td>${formatTime(b.lastSeen)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#6b7280;">No IPs blocked</td></tr>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prove Ownership API - Status Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0fdf4; color: #111827; }
    .header { background: linear-gradient(135deg, #059669, #047857); color: #fff; padding: 32px 24px; }
    .header h1 { font-size: 28px; margin-bottom: 4px; }
    .header p { color: #a7f3d0; font-size: 14px; }
    .stats { display: flex; gap: 16px; padding: 24px; flex-wrap: wrap; }
    .stat-card { background: #fff; border-radius: 12px; padding: 20px 24px; flex: 1; min-width: 160px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
    .stat-card .value { font-size: 32px; font-weight: 700; color: #059669; }
    .stat-card .label { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .stat-card.warn .value { color: #d97706; }
    .stat-card.danger .value { color: #dc2626; }
    .section { padding: 0 24px 24px; }
    .section h2 { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #374151; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
    th { background: #f9fafb; text-align: left; padding: 12px 16px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; }
    td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #f3f4f6; }
    tr:hover td { background: #f9fafb; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .badge-ok { background: #d1fae5; color: #065f46; }
    .badge-err { background: #fee2e2; color: #991b1b; }
    .badge-warn { background: #fef3c7; color: #92400e; }
    .footer { text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; }
    .req-info { background: #fff; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
    .req-info code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    @media (max-width: 640px) { .stats { flex-direction: column; } table { font-size: 12px; } td, th { padding: 8px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 Prove Ownership API</h1>
    <p>Status Dashboard — Environment: ${this._escape(process.env.NODE_ENV || 'development')}</p>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="value">${Math.floor(status.uptime / 60)}m</div>
      <div class="label">Uptime</div>
    </div>
    <div class="stat-card ${status.totalErrors > 0 ? 'danger' : ''}">
      <div class="value">${status.totalErrors}</div>
      <div class="label">Total Errors</div>
    </div>
    <div class="stat-card">
      <div class="value">${status.blockedIpCount}</div>
      <div class="label">Blocked IPs</div>
    </div>
    <div class="stat-card">
      <div class="value">${process.env.PORT || 3001}</div>
      <div class="label">Server Port</div>
    </div>
  </div>

  <div class="section">
    <h2>📋 Request Information</h2>
    <div class="req-info">
      <p><strong>Your IP:</strong> <code>${this._escape(req?.ip || req?.headers?.['x-forwarded-for'] || 'Unknown')}</code></p>
      <p><strong>Path:</strong> <code>${this._escape(req?.originalUrl || '/')}</code></p>
      <p><strong>User-Agent:</strong> <code>${this._escape(req?.headers?.['user-agent'] || 'Unknown')}</code></p>
      <p><strong>Server Time:</strong> <code>${new Date().toISOString()}</code></p>
      <p><strong>Database:</strong> <code>${process.env.DB_HOST || 'Not configured'}:${process.env.DB_PORT || 3306}</code></p>
      <p><strong>Frontend URL:</strong> <code>${process.env.FRONTEND_URL || 'Not configured'}</code></p>
    </div>
  </div>

  <div class="section">
    <h2>🚫 Blocked IPs (${blockedIps.length})</h2>
    <table>
      <thead>
        <tr><th>IP Address</th><th>Reason</th><th>Count</th><th>First Seen</th><th>Last Seen</th></tr>
      </thead>
      <tbody>${ipRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>⚠️ Recent Errors (${errors.length})</h2>
    <table>
      <thead>
        <tr><th>#</th><th>Status</th><th>Method</th><th>Path</th><th>Message</th><th>IP</th><th>Timestamp</th></tr>
      </thead>
      <tbody>${errorRows}</tbody>
    </table>
  </div>

  <div class="footer">
    Prove Ownership API Server &mdash; ${new Date().toISOString()}
  </div>
</body>
</html>`;
  }

  _escape(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

const errorStore = new ErrorStore();
module.exports = errorStore;
