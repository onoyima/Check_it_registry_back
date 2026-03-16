// Authentication Middleware
const Database = require("../config");

// Middleware to authenticate JWT tokens
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = Database.verifyJWT(token);

    // Get user from database
    const user = await Database.selectOne(
      "users",
      "id, name, email, role, region",
      "id = ?",
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

// Middleware to require specific roles
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

// Middleware to require admin role
const requireAdmin = requireRole(["admin", "super_admin"]);

// Middleware to require LEA or admin role
const requireLEA = requireRole(["lea", "admin"]);

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireLEA,
};
