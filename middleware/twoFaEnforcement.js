// 2FA enforcement middleware for admin and LEA roles
// Checks two_factor_enabled on users table and enforces MFA verification

const Database = require('../config');

const requireMFA = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Only enforce for admin and LEA roles
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'lea') {
      return next();
    }

    // Check if user has 2FA enabled
    const user = await Database.selectOne(
      'users', 'two_factor_enabled, two_fa_enabled', 'id = ?', [req.user.id]
    );

    const mfaEnabled = user?.two_factor_enabled || user?.two_fa_enabled;

    if (!mfaEnabled) {
      // 2FA not enabled — require setup before proceeding
      return res.status(403).json({
        error: 'Two-factor authentication is required for your role',
        requiresAction: '2fa_setup',
        message: 'Please enable 2FA in your profile settings before accessing this resource.'
      });
    }

    // Verify the MFA token issued by POST /api/security/mfa/verify: a signed,
    // 10-minute token for this user. Its signature is checked, not just decoded.
    const mfaToken = req.headers['x-mfa-token'];
    if (!mfaToken) {
      return res.status(403).json({
        error: 'MFA verification required',
        requiresAction: 'mfa_verify',
        message: 'This action requires recent MFA verification. Call POST /api/security/mfa/initiate first.'
      });
    }

    let payload;
    try {
      payload = Database.verifyJWT(mfaToken);
    } catch (e) {
      return res.status(403).json({
        error: 'MFA token expired or invalid',
        requiresAction: 'mfa_verify',
        message: 'Please verify again.'
      });
    }
    if (payload.type !== 'mfa_token' || payload.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Invalid MFA token',
        requiresAction: 'mfa_verify'
      });
    }

    next();
  } catch (error) {
    console.error('MFA enforcement error:', error);
    return res.status(500).json({ error: 'MFA verification failed' });
  }
};

// Enforce 2FA setup completion — warns admin/LEA but does not block
const require2FASetup = async (req, res, next) => {
  try {
    if (!req.user) return next();

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'lea') {
      return next();
    }

    const user = await Database.selectOne(
      'users', 'two_factor_enabled, two_fa_enabled', 'id = ?', [req.user.id]
    );

    const mfaEnabled = user?.two_factor_enabled || user?.two_fa_enabled;

    if (!mfaEnabled) {
      console.warn(`[2FA] User ${req.user.id} (${req.user.role}) has not enabled 2FA — allowing pass-through`);
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = { requireMFA, require2FASetup };
