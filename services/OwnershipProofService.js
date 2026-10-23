// Ownership proof review and ownership disputes.
//
// Every device carries an ownership level:
//   registered      - the owner confirmed their email (anyone can reach this)
//   proof_submitted - the owner uploaded proof; waiting for an admin
//   verified_owner  - an admin checked the proof (or it came through a
//                     completed transfer/sale from a verified owner)
//   disputed        - someone else has claimed the device; an admin decides
//
// The proof that is accepted depends on the device category (see
// utils/proof-types.js): a receipt or IMEI screen for a phone, a serial
// sticker for a laptop, vehicle licence / customs papers / VIN photo for a
// vehicle, and so on.
const Database = require('../config');
const NotificationService = require('./NotificationService');
const EmailTemplate = require('./EmailTemplate');
const { escapeHtml } = require('../utils/escape-html');
const ProofTypes = require('../utils/proof-types');

const LEVELS = ['registered', 'proof_submitted', 'verified_owner', 'disputed'];
const MAX_PROOFS_PER_DEVICE = 10;

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const fail = (message, status) => Object.assign(new Error(message), { status });

async function notify(userId, subject, html, payload) {
  try {
    const user = await Database.selectOne('users', 'email', 'id = ?', [userId]);
    await Database.insert('notifications', {
      id: Database.generateUUID(),
      user_id: userId,
      channel: 'email',
      recipient: user?.email || null,
      subject,
      message: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000),
      payload: JSON.stringify(payload || {}),
      created_at: new Date(),
    }).catch(() => {});
    if (user?.email) {
      await NotificationService.sendEmailDirect(user.email, `${subject} - Prove Ownership`, EmailTemplate.wrapContent(subject, html));
    }
  } catch (err) {
    console.warn('Ownership notification failed:', err.message);
  }
}

function deviceName(d) {
  return `${escapeHtml(d.brand || '')} ${escapeHtml(d.model || '')}`.trim() || 'your item';
}

const DEVICE_ID_LOOKUP = '(imei = ? OR serial = ? OR vin = ?)';

class OwnershipProofService {
  static get LEVELS() { return LEVELS; }

  static levelOf(device) {
    return LEVELS.includes(device?.ownership_level) ? device.ownership_level : 'registered';
  }

  // Proof types for a category, e.g. for the upload form
  static proofTypesFor(category) {
    return { group: ProofTypes.groupFor(category), types: ProofTypes.typesFor(category) };
  }

  // Owner view: level, accepted proof types, proof history and whether
  // there is an open dispute (without the claimant's identity or files).
  static async getDeviceOwnership(deviceId, user) {
    const device = await Database.selectOne('devices', 'id, user_id, brand, model, category, status, ownership_level, ownership_verified_at', 'id = ?', [deviceId]);
    if (!device) return null;
    const isStaff = ['admin', 'super_admin'].includes(user.role);
    if (device.user_id !== user.id && !isStaff) return null;
    const proofs = await Database.query(
      `SELECT id, proof_type, file_url, note, status, review_note, reviewed_at, created_at
       FROM ownership_proofs WHERE device_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20`,
      [deviceId, device.user_id]
    );
    for (const p of proofs) p.proof_label = ProofTypes.labelOf(p.proof_type);
    const dispute = await Database.queryOne(
      "SELECT id, status, created_at FROM ownership_disputes WHERE device_id = ? AND status = 'open' LIMIT 1",
      [deviceId]
    );
    const { group, types } = this.proofTypesFor(device.category);
    return {
      deviceId: device.id,
      category: device.category,
      level: this.levelOf(device),
      verifiedAt: device.ownership_verified_at || null,
      proofGroup: group,
      proofTypes: types,
      proofs,
      openDispute: dispute || null,
    };
  }

  // Owner uploads a proof document for their own device.
  static async submitProof({ deviceId, user, proofType, fileUrl, note }) {
    const device = await Database.selectOne('devices', 'id, user_id, brand, model, category, status, ownership_level', 'id = ?', [deviceId]);
    if (!device || device.user_id !== user.id) throw fail('Item not found', 404);
    if (!ProofTypes.isAllowed(device.category, proofType)) {
      throw fail(`That kind of proof isn't used for this item. Choose one of: ${ProofTypes.typesFor(device.category).map((t) => t.label).join(', ')}`, 400);
    }
    if (proofType === 'other' && !note) throw fail('Add a short note explaining what this document is', 400);
    if (['stolen', 'lost', 'released'].includes(device.status)) {
      throw fail(`This item is ${device.status}; proof can't be added now`, 409);
    }
    const count = await Database.queryOne('SELECT COUNT(*) AS n FROM ownership_proofs WHERE device_id = ? AND user_id = ?', [deviceId, user.id]);
    if ((count?.n || 0) >= MAX_PROOFS_PER_DEVICE) {
      throw fail('You have uploaded the maximum number of proofs for this item. Please contact support.', 429);
    }
    // Attach to the open dispute if this owner is defending a claim
    const dispute = await Database.queryOne(
      "SELECT id FROM ownership_disputes WHERE device_id = ? AND status = 'open' LIMIT 1", [deviceId]
    );

    const id = Database.generateUUID();
    await Database.insert('ownership_proofs', {
      id,
      device_id: deviceId,
      user_id: user.id,
      dispute_id: dispute ? dispute.id : null,
      proof_type: proofType,
      file_url: fileUrl,
      note: note ? String(note).slice(0, 500) : null,
      status: 'pending',
      created_at: new Date(),
    });

    const level = this.levelOf(device);
    if (level === 'registered') {
      await Database.update('devices', { ownership_level: 'proof_submitted', updated_at: new Date() }, 'id = ?', [deviceId]);
    }
    await Database.logAudit(user.id, 'OWNERSHIP_PROOF_SUBMITTED', 'devices', deviceId, null, { proof_id: id, proof_type: proofType }).catch(() => {});
    return { id, status: 'pending', level: level === 'registered' ? 'proof_submitted' : level };
  }

  // Look up a registered item by IMEI / serial / VIN for the claim form: says
  // which kinds of proof apply, without revealing who owns it.
  static async findClaimable(identifier, user) {
    const id = String(identifier || '').trim();
    if (!id) throw fail('Enter the IMEI, serial number or VIN', 400);
    const device = await Database.selectOne('devices', 'id, user_id, brand, model, category, status', DEVICE_ID_LOOKUP, [id, id, id]);
    if (!device || device.status === 'released') {
      throw fail('No registered item uses this number. You can register it yourself.', 404);
    }
    if (device.user_id === user.id) throw fail('This item is already registered to you', 400);
    const { group, types } = this.proofTypesFor(device.category);
    return { brand: device.brand, model: device.model, category: device.category, proofGroup: group, proofTypes: types };
  }

  // Someone says an item registered by another account is really theirs.
  static async fileClaim({ identifier, user, statement, proofType, fileUrl }) {
    const id = String(identifier || '').trim();
    if (!id) throw fail('Enter the IMEI, serial number or VIN', 400);
    const device = await Database.selectOne('devices', 'id, user_id, brand, model, category, status, ownership_level', DEVICE_ID_LOOKUP, [id, id, id]);
    if (!device || device.status === 'released') {
      throw fail('No registered item uses this number. You can register it yourself.', 404);
    }
    if (device.user_id === user.id) throw fail('This item is already registered to you', 400);
    if (!ProofTypes.isAllowed(device.category, proofType)) {
      throw fail(`Choose one of: ${ProofTypes.typesFor(device.category).map((t) => t.label).join(', ')}`, 400);
    }
    if (!statement || String(statement).trim().length < 20) {
      throw fail('Tell us in a sentence or two why this item is yours (at least 20 characters)', 400);
    }
    const existing = await Database.queryOne(
      "SELECT id FROM ownership_disputes WHERE device_id = ? AND claimant_id = ? AND status = 'open'", [device.id, user.id]
    );
    if (existing) throw fail('You already have an open claim for this item', 409);

    const disputeId = Database.generateUUID();
    await Database.insert('ownership_disputes', {
      id: disputeId,
      device_id: device.id,
      claimant_id: user.id,
      owner_id: device.user_id,
      statement: String(statement).slice(0, 2000),
      status: 'open',
      previous_level: this.levelOf(device),
      created_at: new Date(),
    });
    await Database.insert('ownership_proofs', {
      id: Database.generateUUID(),
      device_id: device.id,
      user_id: user.id,
      dispute_id: disputeId,
      proof_type: proofType,
      file_url: fileUrl,
      note: null,
      status: 'pending',
      created_at: new Date(),
    });
    await Database.update('devices', { ownership_level: 'disputed', updated_at: new Date() }, 'id = ?', [device.id]);
    await Database.logAudit(user.id, 'OWNERSHIP_CLAIM_FILED', 'devices', device.id, null, { dispute_id: disputeId }).catch(() => {});

    const hints = ProofTypes.typesFor(device.category)
      .filter((t) => t.key !== 'other').slice(0, 3)
      .map((t) => escapeHtml(t.label.toLowerCase())).join(', ');
    await notify(device.user_id, 'Someone has claimed one of your items', `
      <p>Another person says they own <strong>${deviceName(device)}</strong>, which is registered to your account.</p>
      <p>While our team reviews this, anyone who checks the item will see it as <strong>disputed</strong>.</p>
      <p>If it is yours, upload proof of ownership (for example: ${hints}) within 7 days.</p>
      <p><a href="${frontendUrl()}/device/${device.id}">Open the item and add proof</a></p>
    `, { type: 'ownership_claim', device_id: device.id, dispute_id: disputeId });

    return { id: disputeId, status: 'open', device: { brand: device.brand, model: device.model } };
  }

  static async getMyClaims(userId) {
    return Database.query(
      `SELECT od.id, od.status, od.created_at, od.resolved_at, od.resolution_note, d.brand, d.model, d.category
       FROM ownership_disputes od JOIN devices d ON od.device_id = d.id
       WHERE od.claimant_id = ? ORDER BY od.created_at DESC LIMIT 50`, [userId]
    );
  }

  // ---------- Admin ----------

  static async listPendingProofs({ status = 'pending', limit = 50 } = {}) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const rows = await Database.query(
      `SELECT p.id, p.proof_type, p.file_url, p.note, p.status, p.created_at, p.review_note, p.reviewed_at,
              d.id AS device_id, d.brand, d.model, d.category, d.imei, d.serial, d.vin, d.license_plate,
              d.status AS device_status, d.ownership_level,
              u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, u.kyc_status AS owner_kyc
       FROM ownership_proofs p
       JOIN devices d ON p.device_id = d.id
       JOIN users u ON p.user_id = u.id
       WHERE p.status = ? AND p.dispute_id IS NULL
       ORDER BY p.created_at ASC LIMIT ?`, [status, lim]
    );
    for (const r of rows) r.proof_label = ProofTypes.labelOf(r.proof_type);
    return rows;
  }

  static async reviewProof({ proofId, admin, decision, note }) {
    if (!['approve', 'reject'].includes(decision)) throw fail('Decision must be approve or reject', 400);
    if (decision === 'reject' && !note) throw fail('Tell the owner why the proof was rejected', 400);
    const proof = await Database.selectOne('ownership_proofs', '*', 'id = ?', [proofId]);
    if (!proof || proof.dispute_id) throw fail('Proof not found', 404);
    const claim = await Database.query(
      "UPDATE ownership_proofs SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
      [decision === 'approve' ? 'approved' : 'rejected', note ? String(note).slice(0, 500) : null, admin.id, proofId]
    );
    if (!claim || claim.affectedRows !== 1) throw fail('This proof has already been reviewed', 409);

    const device = await Database.selectOne('devices', 'id, user_id, brand, model, ownership_level', 'id = ?', [proof.device_id]);
    if (device && device.user_id === proof.user_id && this.levelOf(device) !== 'disputed') {
      if (decision === 'approve') {
        await Database.update('devices', {
          ownership_level: 'verified_owner', ownership_verified_at: new Date(), ownership_verified_by: admin.id, updated_at: new Date(),
        }, 'id = ?', [device.id]);
      } else if (this.levelOf(device) === 'proof_submitted') {
        const stillPending = await Database.queryOne(
          "SELECT id FROM ownership_proofs WHERE device_id = ? AND user_id = ? AND status = 'pending' AND dispute_id IS NULL LIMIT 1",
          [device.id, device.user_id]
        );
        if (!stillPending) await Database.update('devices', { ownership_level: 'registered', updated_at: new Date() }, 'id = ?', [device.id]);
      }
    }
    await Database.logAudit(admin.id, decision === 'approve' ? 'OWNERSHIP_PROOF_APPROVED' : 'OWNERSHIP_PROOF_REJECTED',
      'ownership_proofs', proofId, null, { device_id: proof.device_id, note }).catch(() => {});

    if (device) {
      await notify(proof.user_id,
        decision === 'approve' ? 'Your ownership is verified' : 'We could not verify your ownership proof',
        decision === 'approve'
          ? `<p>Good news: we checked your proof and <strong>${deviceName(device)}</strong> now shows as <strong>Verified owner</strong> to anyone who checks it.</p>`
          : `<p>We could not accept the proof you sent for <strong>${deviceName(device)}</strong>.</p><p><strong>Reason:</strong> ${escapeHtml(note)}</p><p><a href="${frontendUrl()}/device/${device.id}">Upload a clearer proof</a></p>`,
        { type: 'ownership_review', device_id: device.id, decision });
    }
    return { id: proofId, decision };
  }

  static async listDisputes({ status = 'open', limit = 50 } = {}) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const disputes = await Database.query(
      `SELECT od.id, od.status, od.statement, od.created_at, od.resolution_note, od.resolved_at,
              d.id AS device_id, d.brand, d.model, d.category, d.imei, d.serial, d.vin, d.status AS device_status,
              c.id AS claimant_id, c.name AS claimant_name, c.email AS claimant_email, c.kyc_status AS claimant_kyc,
              o.id AS owner_id, o.name AS owner_name, o.email AS owner_email, o.kyc_status AS owner_kyc
       FROM ownership_disputes od
       JOIN devices d ON od.device_id = d.id
       JOIN users c ON od.claimant_id = c.id
       JOIN users o ON od.owner_id = o.id
       WHERE od.status = ? ORDER BY od.created_at ASC LIMIT ?`, [status, lim]
    );
    for (const d of disputes) {
      d.proofs = await Database.query(
        `SELECT id, user_id, proof_type, file_url, note, status, created_at FROM ownership_proofs
         WHERE device_id = ? AND (dispute_id = ? OR (user_id = ? AND status IN ('approved','pending')))
         ORDER BY created_at ASC`, [d.device_id, d.id, d.owner_id]
      );
      for (const p of d.proofs) {
        p.proof_label = ProofTypes.labelOf(p.proof_type);
        p.side = p.user_id === d.claimant_id ? 'claimant' : 'owner';
      }
    }
    return disputes;
  }

  static async resolveDispute({ disputeId, admin, decision, note }) {
    if (!['claimant', 'owner'].includes(decision)) throw fail('Decision must be claimant or owner', 400);
    if (!note) throw fail('Add a short reason; both people will see it', 400);
    const dispute = await Database.selectOne('ownership_disputes', '*', 'id = ?', [disputeId]);
    if (!dispute) throw fail('Dispute not found', 404);

    const moved = await Database.transaction(async (conn) => {
      const [claim] = await conn.execute(
        "UPDATE ownership_disputes SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ? AND status = 'open'",
        [decision === 'claimant' ? 'awarded_claimant' : 'rejected', String(note).slice(0, 1000), admin.id, disputeId]
      );
      if (claim.affectedRows !== 1) return false;
      if (decision === 'claimant') {
        await conn.execute(
          "UPDATE devices SET user_id = ?, ownership_level = 'verified_owner', ownership_verified_at = NOW(), ownership_verified_by = ?, updated_at = NOW() WHERE id = ?",
          [dispute.claimant_id, admin.id, dispute.device_id]
        );
        await conn.execute("UPDATE ownership_proofs SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE dispute_id = ? AND user_id = ? AND status = 'pending'", [admin.id, disputeId, dispute.claimant_id]);
        // The previous owner can no longer sell or transfer it
        await conn.execute("UPDATE marketplace_listings SET status = 'deleted', updated_at = NOW() WHERE device_id = ? AND status IN ('active','paused')", [dispute.device_id]);
        await conn.execute("UPDATE ownership_transfers SET status = 'cancelled', updated_at = NOW() WHERE device_id = ? AND status IN ('initiated','otp_verified','active','awaiting_buyer_otp')", [dispute.device_id]);
      } else {
        const level = dispute.previous_level && dispute.previous_level !== 'disputed' ? dispute.previous_level : 'registered';
        await conn.execute('UPDATE devices SET ownership_level = ?, updated_at = NOW() WHERE id = ?', [level, dispute.device_id]);
        await conn.execute("UPDATE ownership_proofs SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW() WHERE dispute_id = ? AND user_id = ? AND status = 'pending'", [admin.id, disputeId, dispute.claimant_id]);
      }
      return true;
    });
    if (!moved) throw fail('This dispute has already been resolved', 409);

    await Database.logAudit(admin.id, 'OWNERSHIP_DISPUTE_RESOLVED', 'ownership_disputes', disputeId,
      { owner_id: dispute.owner_id }, { decision, note }).catch(() => {});

    const device = await Database.selectOne('devices', 'id, brand, model', 'id = ?', [dispute.device_id]);
    const name = deviceName(device || {});
    if (decision === 'claimant') {
      await notify(dispute.claimant_id, 'Your ownership claim was accepted', `<p>We reviewed your claim and <strong>${name}</strong> is now registered to you as <strong>Verified owner</strong>.</p><p><strong>Note:</strong> ${escapeHtml(note)}</p>`, { type: 'ownership_dispute', dispute_id: disputeId, decision });
      await notify(dispute.owner_id, 'An item was removed from your account', `<p>After reviewing the evidence, <strong>${name}</strong> has been registered to its rightful owner and removed from your account.</p><p><strong>Reason:</strong> ${escapeHtml(note)}</p><p>If you believe this is wrong, reply to this email or contact support.</p>`, { type: 'ownership_dispute', dispute_id: disputeId, decision });
    } else {
      await notify(dispute.claimant_id, 'Your ownership claim was not accepted', `<p>We reviewed your claim for <strong>${name}</strong> and it stays with its current owner.</p><p><strong>Reason:</strong> ${escapeHtml(note)}</p>`, { type: 'ownership_dispute', dispute_id: disputeId, decision });
      await notify(dispute.owner_id, 'The claim on your item was closed', `<p>The ownership claim on <strong>${name}</strong> was closed in your favour.</p>`, { type: 'ownership_dispute', dispute_id: disputeId, decision });
    }
    return { id: disputeId, decision };
  }

  // After a completed transfer or sale: the new owner keeps "verified
  // owner" only if the seller had it (an unbroken chain of checked ownership).
  static async carryOverLevel(deviceId, sellerLevel) {
    const level = sellerLevel === 'verified_owner' ? 'verified_owner' : 'registered';
    await Database.query(
      "UPDATE devices SET ownership_level = ?, ownership_verified_at = IF(? = 'verified_owner', NOW(), NULL), updated_at = NOW() WHERE id = ?",
      [level, level, deviceId]
    ).catch((e) => console.warn('Ownership level carry-over failed:', e.message));
  }
}

module.exports = OwnershipProofService;
