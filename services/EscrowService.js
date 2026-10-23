const Database = require('../config');
const PaymentService = require('./PaymentService');

class EscrowService {
  static async getPlatformFeePercent() {
    const row = await Database.selectOne('system_settings', 'setting_value', "setting_key = 'platform_fee_percent'");
    return parseFloat(row?.setting_value || '2.50');
  }

  static async holdFunds({ transactionId, listingId, buyerId, sellerId, amount, currency, provider, paymentReference, providerReference }) {
    const feePercent = await this.getPlatformFeePercent();
    const platformFee = parseFloat((amount * feePercent / 100).toFixed(2));
    const sellerAmount = parseFloat((amount - platformFee).toFixed(2));

    const escrowId = Database.generateUUID();
    await Database.insert('escrow_transactions', {
      id: escrowId,
      transaction_id: transactionId,
      listing_id: listingId,
      buyer_id: buyerId,
      seller_id: sellerId,
      amount,
      platform_fee_percent: feePercent,
      platform_fee_amount: platformFee,
      seller_amount: sellerAmount,
      status: 'held',
      payment_provider: provider || 'paystack',
      payment_reference: paymentReference || null,
      provider_reference: providerReference || null,
      created_at: new Date(),
    });

    return { escrowId, platformFee, sellerAmount, feePercent };
  }

  // Move the sold device to the buyer in the registry and log the change.
  static async transferDeviceToBuyer(listingId, buyerId) {
    const listing = await Database.selectOne('marketplace_listings', 'device_id, seller_id', 'id = ?', [listingId]);
    if (!listing) return;
    const before = await Database.selectOne('devices', 'ownership_level', 'id = ?', [listing.device_id]);
    const moved = await Database.query(
      'UPDATE devices SET user_id = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [buyerId, listing.device_id, listing.seller_id]
    );
    if (moved && moved.affectedRows === 1) {
      await require('./OwnershipProofService').carryOverLevel(listing.device_id, before?.ownership_level);
    }
    await Database.logAudit(buyerId, 'DEVICE_SOLD_VIA_MARKETPLACE', 'devices', listing.device_id,
      { user_id: listing.seller_id }, { user_id: buyerId }).catch(() => {});
  }

  static async confirmDelivery(escrowId, userId) {
    const escrow = await Database.selectOne('escrow_transactions', '*', 'id = ?', [escrowId]);
    if (!escrow) throw new Error('Escrow transaction not found');
    if (escrow.buyer_id !== userId) throw new Error('Only the buyer can confirm delivery');
    if (escrow.status !== 'held') throw new Error(`Cannot confirm delivery. Escrow is ${escrow.status}`);

    // Claim the escrow atomically so a double click can't pay the seller twice
    const claim = await Database.query(
      "UPDATE escrow_transactions SET status = 'released', released_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'held'",
      [escrowId]
    );
    if (!claim || claim.affectedRows !== 1) throw new Error('This order has already been confirmed');

    // The buyer now owns the device in the registry
    await this.transferDeviceToBuyer(escrow.listing_id, userId);

    const deliveryId = Database.generateUUID();
    await Database.insert('delivery_confirmations', {
      id: deliveryId,
      escrow_id: escrowId,
      listing_id: escrow.listing_id,
      buyer_id: userId,
      seller_id: escrow.seller_id,
      status: 'confirmed',
      confirmed_at: new Date(),
    });

    // Create seller payout transaction
    const payoutTxId = Database.generateUUID();
    const payoutReference = `PAYOUT-${escrowId.slice(0, 8)}-${Date.now()}`;

    // Attempt real Paystack transfer to seller's bank account
    let payoutResult = { attempted: false, success: false, transferCode: null };
    try {
      payoutResult = await require('./escrow').get(escrow.payment_provider || 'paystack').release({
        sellerId: escrow.seller_id,
        amount: escrow.seller_amount,
        reference: payoutReference,
        reason: `Marketplace payout for listing ${escrow.listing_id.slice(0, 8)}`,
      });
      payoutResult.attempted = true;
    } catch (err) {
      payoutResult.attempted = true;
      payoutResult.success = false;
      payoutResult.error = err.message;
    }

    await Database.insert('transactions', {
      id: payoutTxId,
      user_id: escrow.seller_id,
      amount: escrow.seller_amount,
      currency: 'NGN',
      type: 'marketplace_sale',
      status: payoutResult.success ? 'completed' : 'pending',
      reference: payoutResult.transferCode || payoutReference,
      related_entity_type: 'marketplace_listing',
      related_entity_id: escrow.listing_id,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Record platform fee
    if (escrow.platform_fee_amount > 0) {
      await Database.insert('transactions', {
        id: Database.generateUUID(),
        user_id: escrow.seller_id,
        amount: escrow.platform_fee_amount,
        currency: 'NGN',
        type: 'service_fee',
        status: 'completed',
        related_entity_type: 'marketplace_listing',
        related_entity_id: escrow.listing_id,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    return {
      success: true,
      deliveryId,
      releasedAmount: escrow.seller_amount,
      payout: payoutResult,
      message: payoutResult.success
        ? 'Funds transferred to seller bank account.'
        : payoutResult.attempted
          ? `Funds released. Payout pending: ${payoutResult.error || 'Seller needs to set up bank account.'}`
          : 'Funds released. Payout queued.',
    };
  }

  static async disputeDelivery(escrowId, userId, reason) {
    const escrow = await Database.selectOne('escrow_transactions', '*', 'id = ?', [escrowId]);
    if (!escrow) throw new Error('Escrow transaction not found');
    if (escrow.buyer_id !== userId) throw new Error('Only the buyer can dispute delivery');
    if (escrow.status !== 'held') throw new Error(`Cannot dispute. Escrow is ${escrow.status}`);

    const deliveryId = Database.generateUUID();
    await Database.insert('delivery_confirmations', {
      id: deliveryId,
      escrow_id: escrowId,
      listing_id: escrow.listing_id,
      buyer_id: userId,
      seller_id: escrow.seller_id,
      status: 'disputed',
      disputed_at: new Date(),
      dispute_reason: reason,
    });

    await Database.update('escrow_transactions', {
      status: 'disputed',
      updated_at: new Date(),
    }, 'id = ?', [escrowId]);

    return { success: true, deliveryId };
  }

  static async adminResolveDispute(escrowId, adminId, action, adminNotes) {
    const escrow = await Database.selectOne('escrow_transactions', '*', 'id = ?', [escrowId]);
    if (!escrow) throw new Error('Escrow transaction not found');
    if (escrow.status !== 'disputed') throw new Error(`Cannot resolve. Escrow is ${escrow.status}`);
    if (!['release', 'refund'].includes(action)) throw new Error('Action must be release or refund');

    // Claim the dispute atomically so two admins can't both resolve it
    const claim = await Database.query(
      "UPDATE escrow_transactions SET status = ?, updated_at = NOW() WHERE id = ? AND status = 'disputed'",
      [action === 'release' ? 'released' : 'refunded', escrowId]
    );
    if (!claim || claim.affectedRows !== 1) throw new Error('This dispute has already been resolved');
    if (action === 'release') {
      await this.transferDeviceToBuyer(escrow.listing_id, escrow.buyer_id);
    }

    if (action === 'release') {
      await Database.update('delivery_confirmations', {
        status: 'confirmed',
        confirmed_at: new Date(),
        admin_notes: adminNotes,
        updated_at: new Date(),
      }, 'escrow_id = ? AND status = ?', [escrowId, 'disputed']);

      await Database.update('escrow_transactions', {
        status: 'released',
        released_at: new Date(),
        updated_at: new Date(),
      }, 'id = ?', [escrowId]);

      const payoutTxId = Database.generateUUID();
      const payoutReference = `ADMIN-RELEASE-${escrowId.slice(0, 8)}-${Date.now()}`;

      let payoutResult = { attempted: false, success: false, transferCode: null };
      try {
        payoutResult = await require('./escrow').get(escrow.payment_provider || 'paystack').release({
          sellerId: escrow.seller_id,
          amount: escrow.seller_amount,
          reference: payoutReference,
          reason: `Admin dispute resolution — release to seller for listing ${escrow.listing_id.slice(0, 8)}`,
        });
        payoutResult.attempted = true;
      } catch (err) {
        payoutResult.attempted = true;
        payoutResult.success = false;
        payoutResult.error = err.message;
      }

      await Database.insert('transactions', {
        id: payoutTxId,
        user_id: escrow.seller_id,
        amount: escrow.seller_amount,
        currency: 'NGN',
        type: 'marketplace_sale',
        status: payoutResult.success ? 'completed' : 'pending',
        reference: payoutResult.transferCode || payoutReference,
        related_entity_type: 'marketplace_listing',
        related_entity_id: escrow.listing_id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      return { success: true, action: 'release', releasedAmount: escrow.seller_amount, payout: payoutResult };
    } else if (action === 'refund') {
      await Database.update('delivery_confirmations', {
        admin_notes: adminNotes,
        updated_at: new Date(),
      }, 'escrow_id = ? AND status = ?', [escrowId, 'disputed']);

      // Send the money back through the provider that took it
      let refund = { success: false, refundReference: null, error: null };
      try {
        refund = await require('./escrow').get(escrow.payment_provider || 'paystack').refund({
          paymentReference: escrow.payment_reference,
          providerReference: escrow.provider_reference || escrow.payment_reference,
          amount: Number(escrow.amount),
          reference: `REFUND-${escrowId.slice(0, 8)}-${Date.now()}`,
          reason: adminNotes || 'Order refunded after a dispute',
        });
      } catch (err) {
        refund.error = err.message;
        console.error('Escrow refund failed:', err.message);
      }

      await Database.update('escrow_transactions', {
        status: 'refunded',
        refunded_at: new Date(),
        refund_reference: refund.refundReference || null,
        updated_at: new Date(),
      }, 'id = ?', [escrowId]);

      // Credit buyer: refund transaction
      await Database.insert('transactions', {
        id: Database.generateUUID(),
        user_id: escrow.buyer_id,
        amount: escrow.amount,
        currency: 'NGN',
        type: 'marketplace_refund',
        status: refund.success ? 'completed' : 'pending',
        reference: refund.refundReference || null,
        payment_provider: escrow.payment_provider || 'paystack',
        related_entity_type: 'marketplace_listing',
        related_entity_id: escrow.listing_id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      return {
        success: true, action: 'refund', refundedAmount: escrow.amount, refund,
        message: refund.success ? 'Refund sent to the buyer.' : `Marked refunded. The refund still needs to be sent: ${refund.error || 'the payment provider did not confirm it'}.`,
      };
    } else {
      throw new Error('Invalid action. Use "release" or "refund".');
    }
  }

  static async getEscrowStatus(listingId, userId) {
    const sql = `
      SELECT e.*, dc.status as delivery_status, dc.dispute_reason, dc.admin_notes,
             dc.confirmed_at, dc.disputed_at
      FROM escrow_transactions e
      LEFT JOIN delivery_confirmations dc ON dc.escrow_id = e.id
      WHERE e.listing_id = ? AND (e.buyer_id = ? OR e.seller_id = ?)
      ORDER BY e.created_at DESC LIMIT 1
    `;
    const rows = await Database.query(sql, [listingId, userId, userId]);
    if (!rows.length) return null;
    return rows[0];
  }

  static async getBuyerOrders(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const sql = `
      SELECT e.id as escrow_id, e.amount, e.status as escrow_status,
             e.platform_fee_percent, e.platform_fee_amount, e.seller_amount,
             e.created_at, e.released_at,
             dc.status as delivery_status, dc.dispute_reason,
             dc.confirmed_at, dc.disputed_at,
             l.id as listing_id, l.title as listing_title, l.price as listing_price,
             l.images, d.brand as device_brand, d.model as device_model,
             u.name as seller_name, u.email as seller_email
      FROM escrow_transactions e
      JOIN marketplace_listings l ON e.listing_id = l.id
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON e.seller_id = u.id
      LEFT JOIN delivery_confirmations dc ON dc.escrow_id = e.id
      WHERE e.buyer_id = ?
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await Database.query(sql, [userId, limit, offset]);
    const [{ total }] = await Database.query(
      `SELECT COUNT(*) as total FROM escrow_transactions WHERE buyer_id = ?`,
      [userId]
    );
    return {
      data: rows.map(r => ({
        ...r,
        images: typeof r.images === 'string' ? JSON.parse(r.images) : (r.images || []),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  static async getSellerOrders(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const sql = `
      SELECT e.id as escrow_id, e.amount, e.status as escrow_status,
             e.platform_fee_percent, e.platform_fee_amount, e.seller_amount,
             e.created_at, e.released_at,
             dc.status as delivery_status, dc.dispute_reason,
             dc.confirmed_at, dc.disputed_at,
             l.id as listing_id, l.title as listing_title, l.price as listing_price,
             l.images, d.brand as device_brand, d.model as device_model,
             u.name as buyer_name, u.email as buyer_email
      FROM escrow_transactions e
      JOIN marketplace_listings l ON e.listing_id = l.id
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON e.buyer_id = u.id
      LEFT JOIN delivery_confirmations dc ON dc.escrow_id = e.id
      WHERE e.seller_id = ?
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await Database.query(sql, [userId, limit, offset]);
    const [{ total }] = await Database.query(
      `SELECT COUNT(*) as total FROM escrow_transactions WHERE seller_id = ?`,
      [userId]
    );
    return {
      data: rows.map(r => ({
        ...r,
        images: typeof r.images === 'string' ? JSON.parse(r.images) : (r.images || []),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  static async updatePlatformFeePercent(adminId, percent) {
    const val = parseFloat(percent);
    if (isNaN(val) || val < 0 || val > 100) throw new Error('Fee percent must be between 0 and 100');
    const formatted = val.toFixed(2);

    await Database.query(
      "UPDATE system_settings SET setting_value = ?, updated_by = ?, updated_at = NOW() WHERE setting_key = 'platform_fee_percent'",
      [formatted, adminId]
    );

    return { platform_fee_percent: formatted };
  }

  static async getPlatformFeeSettings() {
    const row = await Database.selectOne('system_settings', 'setting_value, updated_by, updated_at',
      "setting_key = 'platform_fee_percent'");
    return {
      platform_fee_percent: parseFloat(row?.setting_value || '2.50'),
      updated_by: row?.updated_by || null,
      updated_at: row?.updated_at || null,
    };
  }

  static async getAdminEscrows(filters = {}) {
    const { status, limit = 50, offset = 0 } = filters;
    let sql = `
      SELECT e.*, dc.status as delivery_status, dc.dispute_reason, dc.admin_notes,
             l.title as listing_title, 
             b.name as buyer_name, b.email as buyer_email,
             s.name as seller_name, s.email as seller_email
      FROM escrow_transactions e
      JOIN marketplace_listings l ON e.listing_id = l.id
      JOIN users b ON e.buyer_id = b.id
      JOIN users s ON e.seller_id = s.id
      LEFT JOIN delivery_confirmations dc ON dc.escrow_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND e.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    return Database.query(sql, params);
  }
}

module.exports = EscrowService;
