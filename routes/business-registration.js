const express = require('express');
const router = express.Router();
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/register', requireRole(['business']), async (req, res) => {
  try {
    const {
      businessName, registrationNumber, businessType, sector,
      businessAddress, businessPhone, businessEmail, website,
      state, city, country, expectedDeviceVolume, businessDescription
    } = req.body;

    if (!businessName || !registrationNumber) {
      return res.status(400).json({ error: 'Business name and registration number are required' });
    }

    const existing = await Database.selectOne('business_profiles', 'id', 'user_id = ?', [req.user.id]);
    if (existing) {
      await Database.update('business_profiles', {
        business_name: businessName,
        business_registration_number: registrationNumber,
        business_type: businessType || 'other',
        sector: sector || null,
        business_address: businessAddress || null,
        business_phone: businessPhone || null,
        business_email: businessEmail || null,
        website: website || null,
        state: state || null,
        city: city || null,
        country: country || null,
        expected_device_volume: expectedDeviceVolume || null,
        business_description: businessDescription || null,
        updated_at: new Date(),
      }, 'user_id = ?', [req.user.id]);
    } else {
      await Database.insert('business_profiles', {
        id: Database.generateUUID(),
        user_id: req.user.id,
        business_name: businessName,
        business_type: businessType || 'other',
        business_registration_number: registrationNumber,
        business_address: businessAddress || null,
        business_phone: businessPhone || null,
        business_email: businessEmail || null,
        website: website || null,
        state: state || null,
        city: city || null,
        country: country || null,
        expected_device_volume: expectedDeviceVolume || null,
        business_description: businessDescription || null,
        sector: sector || null,
        verification_status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    await Database.update('users', {
      role: 'business',
      updated_at: new Date(),
    }, 'id = ?', [req.user.id]);

    await Database.logAudit(req.user.id, 'BUSINESS_PROFILE_CREATED', 'business_profiles', req.user.id,
      null, { business_name: businessName, rc_number: registrationNumber }, req.ip);

    res.json({
      success: true,
      message: 'Business profile saved. Proceed to verification to complete CAC verification.',
    });
  } catch (error) {
    console.error('Business registration error:', error);
    res.status(500).json({ error: error.message || 'Failed to save business profile' });
  }
});

router.get('/profile', requireRole(['business', 'admin']), async (req, res) => {
  try {
    const profile = await Database.selectOne('business_profiles', '*', 'user_id = ?', [req.user.id]);
    res.json({ profile: profile || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch business profile' });
  }
});

module.exports = router;
