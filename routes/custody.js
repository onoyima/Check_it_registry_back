// Items ProveOwnership is holding after they were reported stolen or lost.
//   Owner:        GET /mine, GET /device/:deviceId, POST /:id/release
//   Admin/police: GET /desk, POST /:id/found, POST /:id/handover
//   Admin:        POST /:id/waive
const express = require('express');
const router = express.Router();
const Database = require('../config');
const { authenticateToken, requireRole } = require('../middleware/auth');
const CustodyService = require('../services/CustodyService');

router.use(authenticateToken);

const send = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong', ...(e.requiresPayment ? { requiresPayment: true, amount: e.amount, feeType: 'device_release_fee' } : {}) });

const COLUMNS = `c.id, c.device_id, c.report_id, c.status, c.held_since, c.found_at, c.found_note, c.release_fee, c.release_paid_at, c.released_at,
  d.brand, d.model, d.category, d.imei, d.serial, d.vin, r.case_id, r.report_type`;

// Police can only act on items whose owner is in their region
async function canHandle(req, custodyId) {
  if (['admin', 'super_admin'].includes(req.user.role)) return true;
  if (req.user.role !== 'lea') return false;
  const row = await Database.queryOne('SELECT u.region FROM device_custody c JOIN users u ON u.id = c.owner_id WHERE c.id = ?', [custodyId]);
  return !!row && (!req.user.region || row.region === req.user.region);
}

router.get('/mine', async (req, res) => {
  try {
    const items = await Database.query(`SELECT ${COLUMNS} FROM device_custody c JOIN devices d ON d.id = c.device_id LEFT JOIN reports r ON r.id = c.report_id
      WHERE c.owner_id = ? AND c.status IN ('held','found','release_paid') ORDER BY c.created_at DESC`, [req.user.id]);
    res.json({ items, release_fee: await CustodyService.fee() });
  } catch (e) { send(res, e); }
});

router.get('/device/:deviceId', async (req, res) => {
  try {
    const device = await Database.selectOne('devices', 'id, user_id', 'id = ?', [req.params.deviceId]);
    if (!device || (device.user_id !== req.user.id && !['admin', 'super_admin', 'lea'].includes(req.user.role))) return res.status(404).json({ error: 'Not found' });
    const c = await CustodyService.openFor(device.id);
    res.json({ custody: c ? { id: c.id, status: c.status, held_since: c.held_since, found_at: c.found_at, release_paid_at: c.release_paid_at } : null, release_fee: await CustodyService.fee() });
  } catch (e) { send(res, e); }
});

router.post('/:id/release', async (req, res) => {
  try {
    res.json(await CustodyService.payRelease(req.user.id, req.params.id, req.body?.pay_by_pass));
  } catch (e) { send(res, e); }
});

router.get('/desk', requireRole(['admin', 'super_admin', 'lea']), async (req, res) => {
  try {
    const status = String(req.query.status || 'open');
    const where = status === 'open' ? "c.status IN ('held','found','release_paid')" : 'c.status = ?';
    const params = status === 'open' ? [] : [status];
    let region = '';
    if (req.user.role === 'lea' && req.user.region) { region = ' AND u.region = ?'; params.push(req.user.region); }
    const items = await Database.query(`SELECT ${COLUMNS}, u.name AS owner_name, u.first_name AS owner_first_name, u.last_name AS owner_last_name, u.email AS owner_email, u.phone AS owner_phone
      FROM device_custody c JOIN devices d ON d.id = c.device_id JOIN users u ON u.id = c.owner_id LEFT JOIN reports r ON r.id = c.report_id
      WHERE ${where}${region} ORDER BY FIELD(c.status, 'release_paid', 'found', 'held'), c.updated_at DESC LIMIT 200`, params);
    res.json({ items, release_fee: await CustodyService.fee() });
  } catch (e) { send(res, e); }
});

router.post('/:id/found', requireRole(['admin', 'super_admin', 'lea']), async (req, res) => {
  try {
    if (!(await canHandle(req, req.params.id))) return res.status(403).json({ error: 'This item is outside your region' });
    const c = await CustodyService.markFound(req.params.id, req.user.id, req.body?.note);
    if (!c) return res.status(404).json({ error: 'This item is not being held' });
    res.json({ success: true, status: c.status });
  } catch (e) { send(res, e); }
});

router.post('/:id/handover', requireRole(['admin', 'super_admin', 'lea']), async (req, res) => {
  try {
    if (!(await canHandle(req, req.params.id))) return res.status(403).json({ error: 'This item is outside your region' });
    res.json(await CustodyService.release(req.params.id, req.user.id, 'handed_over'));
  } catch (e) { send(res, e); }
});

router.post('/:id/waive', requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    res.json(await CustodyService.waive(req.params.id, req.user.id));
  } catch (e) { send(res, e); }
});

module.exports = router;
