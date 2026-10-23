// Older identity endpoints, kept for any client still calling them. They
// now go through the one shared identity check (IdentityService), so they
// no longer call Prembly directly, return Prembly's data, or store the NIN
// in plain text.
const express = require('express');
const router = express.Router();
const Database = require('../config');
const IdentityService = require('../services/IdentityService');
const { authenticateToken } = require('../middleware/auth');

const confirm = async (req, res) => {
  try {
    const nin = req.body?.nin;
    await IdentityService.confirmNin(req.user.id, nin, 'identity_page');
    res.json({ success: true, status: 'verified', message: 'Your identity is confirmed.' });
  } catch (e) {
    if (e instanceof IdentityService.IdentityError) return res.status(e.status || 400).json({ success: false, error: e.message });
    console.error('KYC route error:', e);
    res.status(500).json({ error: 'Could not confirm your identity. Please try again.' });
  }
};

router.post('/lookup', authenticateToken, confirm);
router.post('/verify', authenticateToken, express.json(), confirm);

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
