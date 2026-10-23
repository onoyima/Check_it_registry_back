// Reported items are held by ProveOwnership.
//
// When an item is reported stolen or lost, ProveOwnership becomes its
// temporary holder: the owner stays on record, but the item can't be sold,
// transferred, released or listed, and anyone who checks it is told it is
// held by ProveOwnership. To get it back the owner pays the release fee
// (set by the admin as "device_release_fee").
//
//   held ──(found by police/finder/admin)──> found ──(owner pays)──> release_paid ──(handed over)──> released
//   held ──(owner has it back, pays)─────────────────────────────────────────────────────────────────> released
//   any open state ──(admin dismisses the report)──> closed
const Database = require('../config');
const RevenueService = require('./RevenueService');

const OPEN = ['held', 'found', 'release_paid'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

class CustodyService {
  static get OPEN() { return OPEN; }

  static async openFor(deviceId) {
    return Database.selectOne('device_custody', '*', `device_id = ? AND status IN ('held','found','release_paid') ORDER BY created_at DESC LIMIT 1`, [deviceId]);
  }

  static async fee() { return Number(await RevenueService.getFee('device_release_fee')) || 0; }

  // Called when a stolen/lost report is filed
  static async hold(deviceId, reportId, ownerId) {
    const existing = await this.openFor(deviceId);
    if (existing) return existing;
    const row = { id: Database.generateUUID(), device_id: deviceId, report_id: reportId, owner_id: ownerId, status: 'held', held_since: new Date(), created_at: new Date(), updated_at: new Date() };
    await Database.insert('device_custody', row);
    await Database.logAudit(ownerId, 'CUSTODY_HELD', 'device_custody', row.id, null, { deviceId, reportId }).catch(() => {});
    return row;
  }

  // Police, a finder or an admin has the item
  static async markFound(custodyOrDeviceId, byUserId, note) {
    const c = await Database.selectOne('device_custody', '*', `(id = ? OR device_id = ?) AND status IN ('held','found','release_paid') ORDER BY created_at DESC LIMIT 1`, [custodyOrDeviceId, custodyOrDeviceId]);
    if (!c) return null;
    if (c.status === 'held') {
      await Database.update('device_custody', { status: 'found', found_at: new Date(), found_note: note ? String(note).slice(0, 1000) : null, updated_at: new Date() }, 'id = ?', [c.id]);
      await Database.update('devices', { status: 'found', updated_at: new Date() }, 'id = ?', [c.device_id]);
      await this.notifyOwner(c, 'found');
      await Database.logAudit(byUserId || null, 'CUSTODY_FOUND', 'device_custody', c.id, { status: 'held' }, { status: 'found' }).catch(() => {});
    }
    return Database.selectOne('device_custody', '*', 'id = ?', [c.id]);
  }

  /**
   * The owner pays the release fee. If the item was still "held" (the owner
   * has it back themselves), paying releases it at once. If it was "found"
   * (police or a finder has it), it is released when it is handed over.
   */
  static async payRelease(ownerId, custodyId, payByPass) {
    const c = await Database.selectOne('device_custody', '*', 'id = ? AND owner_id = ?', [custodyId, ownerId]);
    if (!c) throw fail('Not found', 404);
    if (!['held', 'found'].includes(c.status)) throw fail(c.status === 'release_paid' ? 'The release fee is already paid. The item will be handed back to you.' : 'This item is not being held.');
    const fee = await this.fee();
    let reference = null;
    if (fee > 0) {
      if (!payByPass) return { requiresPayment: true, amount: fee, currency: 'NGN', feeType: 'device_release_fee', purpose: 'Release fee' };
      const inv = await RevenueService.redeemPaidInvoice(ownerId, payByPass, ['device_release_fee']);
      if (!inv) throw Object.assign(fail('We could not confirm your payment for the release fee.', 402), { requiresPayment: true, amount: fee });
      reference = inv.reference;
      await Database.insert('transactions', {
        id: Database.generateUUID(), user_id: ownerId, type: 'device_release_fee', amount: fee, status: 'completed',
        reference, related_entity_id: c.id, description: 'Release fee for a reported item', created_at: new Date(),
      }).catch((e) => console.warn('[Custody] transaction:', e.message));
    }
    await Database.update('device_custody', { status: 'release_paid', release_fee: fee, release_reference: reference, release_paid_at: new Date(), updated_at: new Date() }, 'id = ?', [c.id]);
    await Database.logAudit(ownerId, 'CUSTODY_RELEASE_PAID', 'device_custody', c.id, null, { fee, reference }).catch(() => {});
    if (c.status === 'held') return { ...(await this.release(c.id, ownerId, 'owner_recovered')), paid: true };
    return { paid: true, status: 'release_paid', message: 'Release fee paid. The police or our team will hand the item back to you.' };
  }

  // Admin only: let the owner have it back without the fee
  static async waive(custodyId, adminId) {
    const c = await Database.selectOne('device_custody', '*', `id = ? AND status IN ('held','found')`, [custodyId]);
    if (!c) throw fail('This item is not waiting for a release fee.', 404);
    await Database.update('device_custody', { status: 'release_paid', release_fee: 0, fee_waived_by: adminId, release_paid_at: new Date(), updated_at: new Date() }, 'id = ?', [c.id]);
    await Database.logAudit(adminId, 'CUSTODY_FEE_WAIVED', 'device_custody', c.id).catch(() => {});
    if (c.status === 'held') return this.release(c.id, adminId, 'fee_waived');
    return { status: 'release_paid' };
  }

  // Handed back to the owner: the item is theirs again, and the case closes
  static async release(custodyId, byUserId, reason = 'handed_over') {
    const c = await Database.selectOne('device_custody', '*', 'id = ?', [custodyId]);
    if (!c) throw fail('Not found', 404);
    if (c.status !== 'release_paid') throw fail('The owner has not paid the release fee yet.', 409);
    await Database.update('device_custody', { status: 'released', released_at: new Date(), released_by: byUserId || null, closed_reason: reason, updated_at: new Date() }, 'id = ?', [c.id]);
    await Database.update('devices', { status: 'verified', updated_at: new Date() }, 'id = ?', [c.device_id]);
    if (c.report_id) {
      await Database.update('reports', { status: 'resolved', updated_at: new Date() }, "id = ? AND status IN ('open','under_review')", [c.report_id]).catch(() => {});
    }
    // close any finder report on the same item too
    await Database.query("UPDATE reports SET status = 'resolved', updated_at = NOW() WHERE device_id = ? AND report_type = 'found' AND status IN ('open','under_review')", [c.device_id]).catch(() => {});
    await this.notifyOwner(c, 'released');
    await Database.logAudit(byUserId || null, 'CUSTODY_RELEASED', 'device_custody', c.id, null, { reason }).catch(() => {});
    return { status: 'released', message: 'The item is back in your name.' };
  }

  // The report turned out to be wrong: stop holding the item, no fee
  static async close(deviceId, byUserId, reason) {
    const c = await this.openFor(deviceId);
    if (!c) return null;
    await Database.update('device_custody', { status: 'closed', closed_reason: reason, released_by: byUserId || null, released_at: new Date(), updated_at: new Date() }, 'id = ?', [c.id]);
    await Database.update('devices', { status: 'verified', updated_at: new Date() }, "id = ? AND status IN ('stolen','lost','found')", [deviceId]);
    await Database.logAudit(byUserId || null, 'CUSTODY_CLOSED', 'device_custody', c.id, null, { reason }).catch(() => {});
    return c;
  }

  static async notifyOwner(c, what) {
    try {
      const owner = await Database.selectOne('users', 'id, email, name, first_name', 'id = ?', [c.owner_id]);
      const d = await Database.selectOne('devices', 'brand, model', 'id = ?', [c.device_id]);
      if (!owner?.email) return;
      const item = [d?.brand, d?.model].filter(Boolean).join(' ') || 'your item';
      const fee = await this.fee();
      const EmailTemplate = require('./EmailTemplate');
      const NotificationService = require('./NotificationService');
      const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/device/${c.device_id}`;
      const subject = what === 'found' ? `Good news: ${item} has been found` : `${item} is back in your name`;
      const body = what === 'found'
        ? `<p>Hello ${owner.first_name || owner.name || ''},</p><p>The <strong>${item}</strong> you reported has been found. ProveOwnership is holding it for you.</p><p>To get it back, open the item and pay the release fee${fee > 0 ? ` of <strong>₦${fee.toLocaleString()}</strong>` : ''}. The police or our team will then hand it back to you.</p><p><a href="${link}">Open the item</a></p>`
        : `<p>Hello ${owner.first_name || owner.name || ''},</p><p>The <strong>${item}</strong> is back in your name and the case is closed. Thank you for using ProveOwnership.</p>`;
      await NotificationService.queueNotification(owner.id, 'email', owner.email, subject, EmailTemplate.wrapContent(subject, body), { type: `custody_${what}`, custodyId: c.id });
    } catch (e) { console.warn('[Custody] notify:', e.message); }
  }

  // A case closing changes what happens to the item:
  //  - resolved (recovered): it waits for the owner to pay the release fee
  //  - dismissed (the report was wrong): it is let go without a fee
  static async onCaseStatus(report, status, byUserId) {
    if (!report || !['stolen', 'lost'].includes(report.report_type)) return;
    try {
      if (status === 'resolved') await this.markFound(report.device_id, byUserId, 'Recovered (case resolved)');
      if (status === 'dismissed') await this.close(report.device_id, byUserId, 'report_dismissed');
    } catch (e) { console.error('[Custody] case update:', e.message); }
  }

  // What the owner and checkers see about an item
  static async publicState(deviceId) {
    const c = await this.openFor(deviceId);
    if (!c) return null;
    return { held: true, holder: 'ProveOwnership', status: c.status, since: c.held_since };
  }
}

module.exports = CustodyService;
