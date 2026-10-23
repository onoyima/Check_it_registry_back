// Ownership levels, proof uploads, ownership claims and the admin review queue.
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { userRateLimit } = require('../middleware/userRateLimit');
const FileUploadService = require('../services/FileUploadService');
const OwnershipProofService = require('../services/OwnershipProofService');

router.use(authenticateToken);

const uploadLimit = userRateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many uploads. Please try again in an hour.' });
const adminOnly = requireRole(['admin']);

const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

// Reads the multipart "proof_document" file and saves it under /uploads/proofs
function receiveProof(req, res) {
  return new Promise((resolve) => {
    FileUploadService.getUploadMiddleware('proof_document')(req, res, async (err) => {
      if (err) { res.status(400).json({ error: err.message }); return resolve(null); }
      if (!req.file) { res.status(400).json({ error: 'Choose a photo or PDF of your proof' }); return resolve(null); }
      try {
        const [saved] = await FileUploadService.processUploadedFiles(req.file, req.user.id, null, 'proof_document');
        resolve(saved.url);
      } catch (e) {
        res.status(400).json({ error: e.message || 'Could not save the file' });
        resolve(null);
      }
    });
  });
}

// GET /api/ownership/proof-types?category=laptop - accepted proof for a category
router.get('/proof-types', (req, res) => {
  res.json(OwnershipProofService.proofTypesFor(req.query.category));
});

// GET /api/ownership/device/:id - level, accepted proof and proof history
router.get('/device/:id', async (req, res) => {
  try {
    const data = await OwnershipProofService.getDeviceOwnership(req.params.id, req.user);
    if (!data) return res.status(404).json({ error: 'Item not found' });
    res.json(data);
  } catch (err) { send(res, err, 'Could not load ownership details'); }
});

// POST /api/ownership/device/:id/proof - multipart: proof_document, proof_type, note
router.post('/device/:id/proof', uploadLimit, async (req, res) => {
  const fileUrl = await receiveProof(req, res);
  if (!fileUrl) return undefined;
  try {
    const result = await OwnershipProofService.submitProof({
      deviceId: req.params.id, user: req.user,
      proofType: req.body.proof_type, fileUrl, note: req.body.note,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) { send(res, err, 'Could not submit proof'); }
});

// GET /api/ownership/claims/lookup?identifier=... - what proof a claim needs
router.get('/claims/lookup', async (req, res) => {
  try {
    res.json(await OwnershipProofService.findClaimable(req.query.identifier, req.user));
  } catch (err) { send(res, err, 'Could not look up this item'); }
});

// POST /api/ownership/claims - multipart: identifier, statement, proof_type, proof_document
router.post('/claims', uploadLimit, async (req, res) => {
  const fileUrl = await receiveProof(req, res);
  if (!fileUrl) return undefined;
  try {
    const result = await OwnershipProofService.fileClaim({
      identifier: req.body.identifier, user: req.user,
      statement: req.body.statement, proofType: req.body.proof_type, fileUrl,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) { send(res, err, 'Could not file your claim'); }
});

// GET /api/ownership/claims/mine
router.get('/claims/mine', async (req, res) => {
  try {
    res.json({ claims: await OwnershipProofService.getMyClaims(req.user.id) });
  } catch (err) { send(res, err, 'Could not load your claims'); }
});

// ---------- Admin ----------

router.get('/admin/proofs', adminOnly, async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    res.json({ proofs: await OwnershipProofService.listPendingProofs({ status, limit: req.query.limit }) });
  } catch (err) { send(res, err, 'Could not load proofs'); }
});

router.post('/admin/proofs/:id/review', adminOnly, async (req, res) => {
  try {
    res.json(await OwnershipProofService.reviewProof({
      proofId: req.params.id, admin: req.user, decision: req.body.decision, note: req.body.note,
    }));
  } catch (err) { send(res, err, 'Could not save the review'); }
});

router.get('/admin/disputes', adminOnly, async (req, res) => {
  try {
    const status = ['open', 'awarded_claimant', 'rejected'].includes(req.query.status) ? req.query.status : 'open';
    res.json({ disputes: await OwnershipProofService.listDisputes({ status, limit: req.query.limit }) });
  } catch (err) { send(res, err, 'Could not load disputes'); }
});

router.post('/admin/disputes/:id/resolve', adminOnly, async (req, res) => {
  try {
    res.json(await OwnershipProofService.resolveDispute({
      disputeId: req.params.id, admin: req.user, decision: req.body.decision, note: req.body.note,
    }));
  } catch (err) { send(res, err, 'Could not resolve the dispute'); }
});

module.exports = router;
