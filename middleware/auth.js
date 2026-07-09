const Database = require("../config");
const SecurityService = require("../services/SecurityService");

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = Database.verifyJWT(token);

    const user = await Database.selectOne(
      "users",
      "id, name, email, phone, role, region, kyc_status, is_verified, caution_flag",
      "id = ?",
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = user;
    req.clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    req.userAgent = req.get('User-Agent') || '';
    req.macAddress = req.headers['x-mac-address'] || req.headers['x-client-mac'] || null;

    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
      });
    }
    next();
  };
};

const requireAdmin = requireRole(["admin", "super_admin"]);
const requireLEA = requireRole(["lea", "admin"]);

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
  requireRole,
  requireAdmin,
  requireLEA,
  requireCriticalAction,
  collectAuditContext,
};
