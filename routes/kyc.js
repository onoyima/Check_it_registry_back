// Identity status for the signed-in person.
const express = require('express');
const router = express.Router();
const Database = require('../config');
const IdentityService = require('../services/IdentityService');
const { authenticateToken } = require('../middleware/auth');

// A NIN is only confirmed while filing a report (or during business
// verification). These old "confirm your identity" endpoints are closed.
const gone = (req, res) => res.status(410).json({ error: 'Identity is confirmed with your NIN when you report an item.' });
router.post('/lookup', authenticateToken, gone);
router.post('/verify', authenticateToken, gone);

router.get('/status', authenticateToken, async (req, res) => {
  try {
    const user = await Database.selectOne('users', 'kyc_status, is_verified, caution_flag', 'id = ?', [req.user.id]);
    const st = await IdentityService.status(req.user.id);
    res.json({ kyc_status: st.identity_confirmed ? 'verified' : (user?.kyc_status || 'unverified'), is_verified: st.identity_confirmed, caution_flag: user?.caution_flag || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

module.exports = router;
