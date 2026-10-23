const Database = require('../config');
const PaystackService = require('./PaystackService');
const PIIEncryptionService = require('./PIIEncryptionService');

class MarketplaceService {
  static async createListing(userId, data) {
    const { device_id, title, description, price, currency, condition, location, images } = data;
    
    // Verify device ownership and status
    const device = await Database.selectOne('devices', 'id, user_id, status, ownership_level', 'id = ?', [device_id]);
    if (!device) throw new Error('Device not found');
    if (device.user_id !== userId) throw new Error('You do not own this device');
    if (['stolen', 'lost', 'found'].includes(device.status)) throw new Error('This item is reported and held by ProveOwnership, so it cannot be listed');
    // Buyers only see items whose owner we have checked
    if (device.ownership_level === 'disputed') throw new Error('This item has an open ownership claim and cannot be listed until it is resolved');
    if (device.ownership_level !== 'verified_owner') {
      throw new Error('Only verified owners can sell. Open the item, upload your proof of ownership and list it once our team has approved it.');
    }
    
    // Check if already listed active
    const existing = await Database.selectOne('marketplace_listings', 'id', "device_id = ? AND status IN ('active', 'paused')", [device_id]);
    if (existing) throw new Error('Device is already listed for sale');
    const pendingSale = await Database.queryOne(
      `SELECT e.id FROM escrow_transactions e JOIN marketplace_listings l ON e.listing_id = l.id
       WHERE l.device_id = ? AND e.status IN ('held', 'disputed') LIMIT 1`, [device_id]);
    if (pendingSale) throw new Error('This device has a sale waiting for delivery confirmation');
    if (!(Number(price) > 0)) throw new Error('Price must be a positive number');

    const id = Database.generateUUID();
    const listingData = {
      id,
      seller_id: userId,
      device_id,
      title,
      description,
      price,
      currency: currency || 'NGN',
      device_condition: condition,
      status: 'active',
      location,
      images: JSON.stringify(images || []),
      created_at: new Date(),
      updated_at: new Date()
    };

    await Database.insert('marketplace_listings', listingData);
    return listingData;
  }

  static async getListings(filters = {}) {
    const { 
      search, 
      min_price, 
      max_price, 
      condition, 
      category, 
      brand, 
      location, 
      limit = 20, 
      offset = 0 
    } = filters;

    let sql = `
      SELECT l.*, d.brand, d.model, d.category, d.ownership_level, u.name as seller_name,
        CASE WHEN u.kyc_status = 'verified' THEN 'verified'
             WHEN bp.verification_status = 'verified' THEN 'verified'
             ELSE 'unverified' END as seller_verified
      FROM marketplace_listings l
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON l.seller_id = u.id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    // Default to active if not specified, unless seller_id is present (then show all by default or let filter handle it)
    if (!filters.status && !filters.seller_id) {
         sql += ` AND l.status = 'active'`;
    }

    if (filters.seller_id) {
        sql += ` AND l.seller_id = ?`;
        params.push(filters.seller_id);
    }
    
    if (filters.status && filters.status !== 'all') {
        sql += ` AND l.status = ?`;
        params.push(filters.status);
    }

    if (filters.seller_verified === 'verified') {
        sql += ` AND (u.kyc_status = 'verified' OR bp.verification_status = 'verified')`;
    } else if (filters.seller_verified === 'unverified') {
        sql += ` AND (u.kyc_status IS NULL OR u.kyc_status != 'verified') AND (bp.verification_status IS NULL OR bp.verification_status != 'verified')`;
    }

    if (search) {
      sql += ` AND (l.title LIKE ? OR l.description LIKE ? OR d.brand LIKE ? OR d.model LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    if (min_price) {
      sql += ` AND l.price >= ?`;
      params.push(min_price);
    }
    if (max_price) {
      sql += ` AND l.price <= ?`;
      params.push(max_price);
    }

    if (condition && condition !== 'all') {
      sql += ` AND l.device_condition = ?`;
      params.push(condition);
    }

    if (category && category !== 'all') {
      sql += ` AND d.category = ?`;
      params.push(category);
    }

    if (brand && brand !== 'all') {
      sql += ` AND d.brand = ?`;
      params.push(brand);
    }

    if (location) {
      sql += ` AND l.location LIKE ?`;
      params.push(`%${location}%`);
    }

    sql += ` ORDER BY l.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const listings = await Database.query(sql, params);
    
    // Parse images for frontend
    return listings.map(l => ({
      ...l,
      images: typeof l.images === 'string' ? JSON.parse(l.images) : l.images,
      seller: {
        name: l.seller_name,
        verified: l.seller_verified === 'verified'
      }
    }));
  }

  static async getListingById(id) {
    const sql = `
      SELECT l.*, d.brand, d.model, d.category, d.storage_capacity, d.color, d.ownership_level,
        u.name as seller_name, u.id as seller_id, u.created_at as seller_since,
        CASE WHEN u.kyc_status = 'verified' THEN 'verified'
             WHEN bp.verification_status = 'verified' THEN 'verified'
             ELSE 'unverified' END as seller_verified
      FROM marketplace_listings l
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON l.seller_id = u.id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE l.id = ?
    `;
    const rows = await Database.query(sql, [id]);
    if (!rows.length) return null;
    
    const l = rows[0];
    return {
      ...l,
      images: typeof l.images === 'string' ? JSON.parse(l.images) : l.images,
      seller: {
        id: l.seller_id,
        name: l.seller_name,
        verified: l.seller_verified === 'verified'
      }
    };
  }

  static async updateListing(userId, listingId, data) {
    const listing = await Database.selectOne('marketplace_listings', 'seller_id, status', 'id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');
    if (listing.seller_id !== userId) throw new Error('Unauthorized');

    // Sellers may edit the advert and pause/resume it, or mark a sold item
    // as shipped. Buyer, featured flag, sale state etc. are not theirs to set.
    const updateData = Database.pick(data, ['title', 'description', 'price', 'location']);
    if (data.condition !== undefined || data.device_condition !== undefined) {
      updateData.device_condition = data.device_condition ?? data.condition;
    }
    if (updateData.price !== undefined && !(Number(updateData.price) > 0)) {
      throw new Error('Price must be a positive number');
    }
    if (Array.isArray(data.images)) updateData.images = JSON.stringify(data.images.filter((u) => typeof u === 'string'));
    if (data.status !== undefined) {
      const allowed = {
        active: ['paused'],
        paused: ['active'],
        sold: ['shipped'],
        shipped: ['completed'],
      };
      if (!(allowed[listing.status] || []).includes(data.status)) {
        throw new Error(`Cannot change a ${listing.status} listing to ${data.status}`);
      }
      updateData.status = data.status;
    }
    if (Object.keys(updateData).length === 0) throw new Error('No editable fields supplied');
    updateData.updated_at = new Date();
    
    await Database.update('marketplace_listings', updateData, 'id = ?', [listingId]);
    return { id: listingId, ...updateData };
  }

  static async deleteListing(userId, listingId) {
    const listing = await Database.selectOne('marketplace_listings', 'seller_id', 'id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');
    if (listing.seller_id !== userId) throw new Error('Unauthorized');

    await Database.update('marketplace_listings', { status: 'deleted', updated_at: new Date() }, 'id = ?', [listingId]);
    return true;
  }
  // Step 1: Validate + create pending transaction + initialize Paystack payment
  static async initiatePurchase(buyerId, listingId) {
    const listing = await Database.selectOne('marketplace_listings', '*', 'id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing is no longer available');
    if (listing.seller_id === buyerId) throw new Error('Cannot buy your own listing');

    const buyer = await Database.selectOne('users', 'email, name', 'id = ?', [buyerId]);
    if (!buyer) throw new Error('Buyer not found');

    const PaymentService = require('./PaymentService');
    const Escrow = require('./escrow');
    const provider = await Escrow.current(); // who holds the money until delivery
    const reference = PaystackService.generateReference('PUR');

    // Create pending transaction
    const buyerTx = await PaymentService.createTransaction(
      buyerId, listing.price, 'marketplace_purchase', listingId, 'marketplace_listing'
    );

    // Store reference and provider on the transaction so we can verify later
    await Database.update('transactions', { reference, payment_provider: provider.name, updated_at: new Date() }, 'id = ?', [buyerTx.id]);

    const pay = await provider.initializePayment({
      reference, amount: listing.price, email: buyer.email, name: buyer.name,
      description: `Prove Ownership: ${listing.title}`,
      callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/callback?reference=${encodeURIComponent(reference)}&provider=${provider.name}`,
      metadata: { listing_title: listing.title, transaction_id: buyerTx.id, userId: buyerId, listingId },
    });

    return {
      success: true,
      transactionId: buyerTx.id,
      reference,
      provider: provider.name,
      authorizationUrl: pay.authorizationUrl,
      accessCode: pay.accessCode,
      amount: listing.price,
      message: 'Redirect to the payment page to complete payment.',
    };
  }

  // Step 2: Verify the Paystack payment, close the listing and hold the money
  // in escrow. Runs in one DB transaction with row locks so two calls (e.g.
  // the buyer's return page and the webhook) can't both succeed. Device
  // ownership moves to the buyer only when they confirm delivery.
  static async completePurchase(reference) {
    return this._completeByReference(reference, false);
  }

  static async _completeByReference(reference, bulk) {
    const PaymentService = require('./PaymentService');
    const EscrowService = require('./EscrowService');

    const preview = await Database.select('transactions', '*', 'reference = ?', [reference]);
    if (!preview || preview.length === 0) throw new Error('Transaction not found');
    if (!bulk && preview.length !== 1) throw new Error('Transaction not found');
    if (preview.every((tx) => tx.status === 'completed')) throw new Error('Transaction already completed');

    // Verify with the provider that took this payment (outside the DB transaction: network call)
    const Escrow = require('./escrow');
    const providerName = preview[0].payment_provider || 'paystack';
    const verification = await Escrow.get(providerName).verifyPayment(reference);
    if (!verification.paid) throw new Error('Payment not confirmed');
    const expectedTotal = preview.reduce((sum, tx) => sum + Number(tx.amount), 0);
    if (verification.amount + 0.001 < expectedTotal) {
      throw new Error('Amount paid does not match the order total. Please contact support.');
    }

    const results = await Database.transaction(async (conn) => {
      const [txs] = await conn.execute('SELECT * FROM transactions WHERE reference = ? FOR UPDATE', [reference]);
      if (txs.some((tx) => tx.status === 'completed')) throw new Error('Transaction already completed');

      const out = [];
      for (const buyerTx of txs) {
        const [rows] = await conn.execute('SELECT * FROM marketplace_listings WHERE id = ? FOR UPDATE', [buyerTx.related_entity_id]);
        const listing = rows[0];
        if (!listing) throw new Error('Listing not found');
        if (listing.status !== 'active') throw new Error(`Listing "${listing.title}" is no longer available`);

        await conn.execute("UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = ?", [buyerTx.id]);
        await conn.execute(
          "UPDATE marketplace_listings SET status = 'sold', buyer_id = ?, sold_at = NOW(), updated_at = NOW() WHERE id = ?",
          [buyerTx.user_id, listing.id]
        );
        out.push({ buyerTx, listing });
      }
      return out;
    });

    const escrows = [];
    for (const { buyerTx, listing } of results) {
      const escrow = await EscrowService.holdFunds({
        transactionId: buyerTx.id,
        listingId: listing.id,
        buyerId: buyerTx.user_id,
        sellerId: listing.seller_id,
        amount: Number(buyerTx.amount),
        currency: listing.currency,
        provider: providerName,
        paymentReference: reference,
        providerReference: verification.providerReference || null,
      });
      escrows.push({
        transactionId: buyerTx.id,
        listingId: listing.id,
        escrowId: escrow.escrowId,
        platformFee: escrow.platformFee,
        sellerAmount: escrow.sellerAmount,
      });
    }

    const message = 'Payment held in escrow. The seller is paid, and the device is registered to you, when you confirm delivery.';
    if (bulk) return { success: true, results: escrows, message };
    return { success: true, ...escrows[0], message };
  }

  // Bulk: initiate purchase for multiple listings (cart checkout)
  static async bulkInitiatePurchase(buyerId, items) {
    if (!items || !items.length) throw new Error('No items to purchase');

    const buyer = await Database.selectOne('users', 'email, name', 'id = ?', [buyerId]);
    if (!buyer) throw new Error('Buyer not found');

    // Validate all listings
    const listings = [];
    let totalAmount = 0;
    for (const item of items) {
      const listing = await Database.selectOne('marketplace_listings', '*', 'id = ?', [item.listingId]);
      if (!listing) throw new Error(`Listing ${item.listingId} not found`);
      if (listing.status !== 'active') throw new Error(`Listing "${listing.title}" is no longer available`);
      if (listing.seller_id === buyerId) throw new Error('Cannot buy your own listing');

      const quantity = 1; // each listing is one unique device
      listings.push({ listing, quantity });
      totalAmount += Number(listing.price) * quantity;
    }

    const PaymentService = require('./PaymentService');
    const PaystackService = require('./PaystackService');
    const Escrow = require('./escrow');
    const provider = await Escrow.current();
    const reference = PaystackService.generateReference('BUL');

    // Create transactions for each listing sharing the same reference
    for (const { listing, quantity } of listings) {
      const amount = Number(listing.price) * quantity;
      const buyerTx = await PaymentService.createTransaction(
        buyerId, amount, 'marketplace_purchase', listing.id, 'marketplace_listing'
      );
      await Database.update('transactions', { reference, payment_provider: provider.name, updated_at: new Date() }, 'id = ?', [buyerTx.id]);
    }

    // One payment for the whole cart
    const pay = await provider.initializePayment({
      reference, amount: totalAmount, email: buyer.email, name: buyer.name,
      description: `Prove Ownership: ${items.length} item(s)`,
      callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/callback?reference=${encodeURIComponent(reference)}&provider=${provider.name}`,
      metadata: { item_count: items.length, transaction_count: listings.length, userId: buyerId },
    });

    return {
      success: true,
      reference,
      provider: provider.name,
      authorizationUrl: pay.authorizationUrl,
      accessCode: pay.accessCode,
      amount: totalAmount,
      message: 'Redirect to the payment page to complete payment.',
    };
  }

  // Bulk: complete purchase for all listings in a cart order
  static async bulkCompletePurchase(reference) {
    return this._completeByReference(reference, true);
  }

  static async sendMessage(senderId, listingId, content) {
    const listing = await Database.selectOne('marketplace_listings', 'seller_id', 'id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');
    
    // Determine receiver
    // If sender is NOT seller, they are buyer. Receiver is seller.
    // If sender IS seller, we assume this is a reply and the context (thread) should be handled.
    // However, without a thread ID, we can only support Buyer -> Seller initiation easily here.
    // For MVP validation "users can chat", initiation is key.
    
    let receiverId;
    if (senderId === listing.seller_id) {
         throw new Error('Seller reply logic requires thread context not implemented in this MVP step');
    } else {
        receiverId = listing.seller_id;
    }

    const message = {
        id: Database.generateUUID(),
        listing_id: listingId,
        sender_id: senderId,
        receiver_id: receiverId,
        content: content,
        created_at: new Date()
    };

    await Database.insert('marketplace_messages', message);
    return message;
  }

  static async getMessages(userId, listingId) {
      // Get messages where user is sender or receiver for this listing
      // This is a simplified "one chat per listing per user-pair" view?
      // Actually, if we filter by listing_id and (sender=me OR receiver=me), we see the chat.
      const sql = `
        SELECT * FROM marketplace_messages 
        WHERE listing_id = ? 
        AND (sender_id = ? OR receiver_id = ?)
        ORDER BY created_at ASC
      `;
      return Database.query(sql, [listingId, userId, userId]);
  }
  static async adminGetAllListings(filters = {}) {
    const { 
      search, 
      status,
      limit = 50, 
      offset = 0 
    } = filters;

    let sql = `
      SELECT l.*, d.brand, d.model, d.category, u.name as seller_name, u.email as seller_email,
        CASE WHEN u.kyc_status = 'verified' THEN 'verified'
             WHEN bp.verification_status = 'verified' THEN 'verified'
             ELSE 'unverified' END as seller_verified
      FROM marketplace_listings l
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON l.seller_id = u.id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (l.title LIKE ? OR l.description LIKE ? OR d.brand LIKE ? OR d.model LIKE ? OR u.email_hash = ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, PIIEncryptionService.hashEmail(search));
    }

    if (status && status !== 'all') {
      sql += ` AND l.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY l.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const listings = await Database.query(sql, params);
    
    return listings.map(l => ({
      ...l,
      images: typeof l.images === 'string' ? JSON.parse(l.images) : l.images,
      seller: {
        name: l.seller_name,
        email: l.seller_email,
        verified: l.seller_verified === 'verified'
      },
      featured: !!l.featured
    }));
  }

  static async adminUpdateStatus(listingId, status) {
    if (!['active', 'sold', 'deleted', 'blocked'].includes(status)) {
        throw new Error('Invalid status');
    }
    await Database.update('marketplace_listings', { status, updated_at: new Date() }, 'id = ?', [listingId]);
    return true;
  }

  static async adminToggleFeatured(listingId, featured) {
    await Database.update('marketplace_listings', { featured: featured ? 1 : 0, updated_at: new Date() }, 'id = ?', [listingId]);
    return true;
  }

  static async getSellerStats(userId) {
     const activeListings = await Database.query(`SELECT COUNT(*) as count FROM marketplace_listings WHERE seller_id = ? AND status = 'active'`, [userId]);
     const soldListings = await Database.query(`SELECT COUNT(*) as count FROM marketplace_listings WHERE seller_id = ? AND status IN ('sold', 'shipped', 'completed')`, [userId]);
     const totalRevenue = await Database.query(`SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = 'marketplace_sale'`, [userId]);
     const totalDevices = await Database.query(`SELECT COUNT(*) as count FROM devices WHERE user_id = ?`, [userId]);
     const heldInEscrow = await Database.query(
       `SELECT COALESCE(SUM(amount), 0) as total FROM escrow_transactions WHERE seller_id = ? AND status = 'held'`,
       [userId]
     );
     const pendingPayouts = await Database.query(
       `SELECT COUNT(*) as count FROM escrow_transactions WHERE seller_id = ? AND status = 'held'`,
       [userId]
     );

     return {
         activeListings: activeListings[0].count,
         soldListings: soldListings[0].count,
         revenue: totalRevenue[0].total || 0,
         totalDevices: totalDevices[0].count,
         heldInEscrow: heldInEscrow[0].total || 0,
         pendingPayouts: pendingPayouts[0].count
     };
  }

  static async getSellerOrders(userId, page = 1, limit = 20) {
      const offset = (page - 1) * limit;
      const sql = `
        SELECT l.*, d.brand, d.model, d.category, b.name as buyer_name, b.email as buyer_email,
               e.id as escrow_id, e.status as escrow_status, e.amount as escrow_amount,
               e.platform_fee_percent, e.platform_fee_amount, e.seller_amount,
               e.released_at, dc.status as delivery_status, dc.confirmed_at
        FROM marketplace_listings l
        JOIN devices d ON l.device_id = d.id
        LEFT JOIN users b ON l.buyer_id = b.id
        LEFT JOIN escrow_transactions e ON e.listing_id = l.id
        LEFT JOIN delivery_confirmations dc ON dc.escrow_id = e.id
        WHERE l.seller_id = ? AND l.buyer_id IS NOT NULL
        ORDER BY l.sold_at DESC
        LIMIT ? OFFSET ?
      `;
      const orders = await Database.query(sql, [userId, limit, offset]);
      const [{ total }] = await Database.query(
        `SELECT COUNT(*) as total FROM marketplace_listings WHERE seller_id = ? AND buyer_id IS NOT NULL`,
        [userId]
      );
      return {
        data: orders.map(o => ({
            ...o,
            images: typeof o.images === 'string' ? JSON.parse(o.images) : o.images
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      };
  }
}

module.exports = MarketplaceService;
