const Database = require("../config");
const SecurityService = require("../services/SecurityService");

// Load the user behind a login token and check it is still allowed in.
// Rejects: purpose-specific tokens (email/device/MFA links), unknown users,
// deleted or suspended accounts, and tokens issued before the user's
// token_version was bumped (logout, password change/reset, suspension).
const USER_COLUMNS = 'id, name, first_name, middle_name, last_name, email, phone, role, region, kyc_status, is_verified, caution_flag';

async function loadUserForToken(decoded) {
  if (!decoded || decoded.type || !decoded.id) {
    return { error: 'Invalid token', status: 401 };
  }
  let user;
  try {
    user = await Database.selectOne(
      'users',
      `${USER_COLUMNS}, token_version, suspended_at, deleted_at`,
      'id = ?',
      [decoded.id]
    );
  } catch (err) {
    // Columns added by migration 023 may not exist yet on an old database
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      user = await Database.selectOne('users', USER_COLUMNS, 'id = ?', [decoded.id]);
    } else {
      throw err;
    }
  }
  if (!user || user.deleted_at) {
    return { error: 'Invalid token', status: 401 };
  }
  if (user.suspended_at) {
    return { error: 'Your account is suspended. Contact support.', status: 403 };
  }
  if (user.token_version !== undefined && (decoded.tv || 0) !== (user.token_version || 0)) {
    return { error: 'Your session has ended. Please log in again.', status: 401 };
  }
  delete user.token_version;
  delete user.suspended_at;
  delete user.deleted_at;
  return { user };
}

const authenticateToken = async (req, res, next) => {
  let decoded;
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    decoded = Database.verifyJWT(token);
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const result = await loadUserForToken(decoded);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    req.user = result.user;
    req.clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    req.userAgent = req.get('User-Agent') || '';
    req.macAddress = req.headers['x-mac-address'] || req.headers['x-client-mac'] || null;

    next();
  } catch (error) {
    console.error('Authentication lookup failed:', error.message);
    return res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
  }
};

// Issue a login token carrying the user's current token_version.
async function issueLoginToken(user) {
  let tv = 0;
  try {
    const row = await Database.selectOne('users', 'token_version', 'id = ?', [user.id]);
    tv = (row && row.token_version) || 0;
  } catch (_) { /* column not migrated yet */ }
  return Database.generateJWT({ id: user.id, email: user.email, role: user.role, tv });
}

// Invalidate every login token the user currently holds.
async function revokeUserTokens(userId) {
  try {
    await Database.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
  } catch (err) {
    console.warn('Could not revoke tokens:', err.message);
  }
}

const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    // super_admin can do anything an admin can
    const role = req.user.role;
    const allowed = allowedRoles.includes(role) || (role === 'super_admin' && allowedRoles.includes('admin'));
    if (!allowed) {
      return res.status(403).json({
        error: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
      });
    }
    next();
  };
};

const requireAdmin = requireRole(["admin", "super_admin"]);
const requireLEA = requireRole(["lea", "admin", "super_admin"]);

const requireCriticalAction = (actionType) => {
  return async (req, res, next) => {
    try {
      if (!SecurityService.isCriticalAction(actionType)) {
        return next();
      }

      const preCheck = await SecurityService.enforcePreConditions(req.user.id, actionType);
      if (!preCheck.allowed) {
        return res.status(403).json({
          error: preCheck.error,
          requiresAction: preCheck.requiresAction
        });
      }

      req.criticalAction = { type: actionType, requirements: preCheck.action };
      next();
    } catch (error) {
      console.error('Critical action check error:', error);
      return res.status(500).json({ error: 'Security check failed' });
    }
  };
};

const collectAuditContext = (req, res, next) => {
  if (req.user) {
    req.auditContext = {
      ipAddress: req.clientIp,
      userAgent: req.userAgent,
      macAddress: req.macAddress,
      sessionId: req.headers['x-session-id'] || null,
    };
  }
  next();
};

module.exports = {
  authenticateToken,
  loadUserForToken,
  issueLoginToken,
  revokeUserTokens,
  requireRole,
  requireAdmin,
  requireLEA,
  requireCriticalAction,
  collectAuditContext,
};
