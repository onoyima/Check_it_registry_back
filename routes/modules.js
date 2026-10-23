// Which parts of the app are switched on (public), and the admin controls
// for modules and the marketplace escrow provider.
const express = require('express');
const router = express.Router();
const ModuleService = require('../services/ModuleService');
const Escrow = require('../services/escrow');
const { authenticateToken, requireRole } = require('../middleware/auth');

const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });

// GET /api/modules -> { marketplace: true|false }
router.get('/', async (req, res) => {
  try {
    const out = {};
    for (const m of await ModuleService.list()) out[m.name] = m.on;
    res.json(out);
  } catch (e) { fail(res, e); }
});

const admin = [authenticateToken, requireRole(['admin', 'super_admin'])];

router.get('/admin', admin, async (req, res) => {
  try {
    res.json({ modules: await ModuleService.list(), escrowProviders: await Escrow.list() });
  } catch (e) { fail(res, e); }
});

router.put('/admin/:name', admin, async (req, res) => {
  try {
    const value = await ModuleService.set(req.params.name, !!req.body?.on, req.user.id);
    res.json({ success: true, name: req.params.name, on: value === 'on' });
  } catch (e) { fail(res, e); }
});

router.put('/admin/escrow/provider', admin, async (req, res) => {
  try {
    const name = await Escrow.setCurrent(req.body?.provider, req.user.id);
    res.json({ success: true, provider: name });
  } catch (e) { fail(res, e); }
});

module.exports = router;
