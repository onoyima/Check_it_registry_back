const Database = require('../config');
const PaystackService = require('./PaystackService');

class MarketplaceService {
  static async createListing(userId, data) {
    const { device_id, title, description, price, currency, condition, location, images } = data;
    
    // Verify device ownership and status
    const device = await Database.selectOne('devices', 'id, user_id, status', 'id = ?', [device_id]);
    if (!device) throw new Error('Device not found');
    if (device.user_id !== userId) throw new Error('You do not own this device');
    if (device.status === 'stolen' || device.status === 'lost') throw new Error('Cannot list a reported device');
    
    // Check if already listed active
    const existing = await Database.selectOne('marketplace_listings', 'id', 'device_id = ? AND status = ?', [device_id, 'active']);
    if (existing) throw new Error('Device is already listed for sale');

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
      SELECT l.*, d.brand, d.model, d.category, u.name as seller_name, u.kyc_status as seller_verified
      FROM marketplace_listings l
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON l.seller_id = u.id
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

    console.log('[getListings] SQL:', sql.replace(/\s+/g, ' ').trim());
    console.log('[getListings] params:', JSON.stringify(params));
    const listings = await Database.query(sql, params);
    console.log('[getListings] result count:', listings.length);
    
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
      SELECT l.*, d.brand, d.model, d.category, d.storage_capacity, d.color, u.name as seller_name, u.kyc_status as seller_verified, u.id as seller_id
      FROM marketplace_listings l
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON l.seller_id = u.id
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
    const listing = await Database.selectOne('marketplace_listings', 'seller_id', 'id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');
    if (listing.seller_id !== userId) throw new Error('Unauthorized');

    const updateData = { ...data, updated_at: new Date() };
    if (updateData.images) updateData.images = JSON.stringify(updateData.images);
    
    await Database.update('marketplace_listings', updateData, 'id = ?', [listingId]);
    return { id: listingId, ...data };
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
    const reference = PaystackService.generateReference('PUR');

    // Create pending transaction
    const buyerTx = await PaymentService.createTransaction(
      buyerId, listing.price, 'marketplace_purchase', listingId, 'marketplace_listing'
    );

    // Store reference on the transaction so we can verify later
    await Database.update('transactions', { reference, updated_at: new Date() }, 'id = ?', [buyerTx.id]);

    // Initialize Paystack payment
    const paystack = await PaymentService.initializePaystackPayment({
      userId: buyerId,
      email: buyer.email,
      amount: listing.price,
      reference,
      listingId,
      metadata: { listing_title: listing.title, transaction_id: buyerTx.id },
    });

    return {
      success: true,
      transactionId: buyerTx.id,
      reference,
      authorizationUrl: paystack.authorizationUrl,
      accessCode: paystack.accessCode,
      amount: listing.price,
      message: 'Redirect to Paystack to complete payment.',
    };
  }

  // Step 2: Verify Paystack payment, transfer ownership, close listing, hold escrow
  static async completePurchase(reference) {
    const PaymentService = require('./PaymentService');
    const EscrowService = require('./EscrowService');

    // Find the transaction by reference
    const buyerTx = await Database.selectOne('transactions', '*', 'reference = ?', [reference]);
    if (!buyerTx) throw new Error('Transaction not found');
    if (buyerTx.status === 'completed') throw new Error('Transaction already completed');

    // Verify payment with Paystack
    const verification = await PaymentService.verifyPaystackPayment(reference);
    if (!verification.verified) throw new Error('Payment not confirmed');

    const listing = await Database.selectOne('marketplace_listings', '*', 'id = ?', [buyerTx.related_entity_id]);
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing is no longer available');

    const buyerId = buyerTx.user_id;

    // Mark transaction completed
    await Database.update('transactions', {
      status: 'completed',
      updated_at: new Date(),
    }, 'id = ?', [buyerTx.id]);

    // Transfer device ownership
    await Database.update('devices', { user_id: buyerId, updated_at: new Date() }, 'id = ?', [listing.device_id]);

    // Close listing
    await Database.update('marketplace_listings', {
      status: 'sold', buyer_id: buyerId, sold_at: new Date(), updated_at: new Date(),
    }, 'id = ?', [listing.id]);

    // Hold funds in escrow
    const escrow = await EscrowService.holdFunds({
      transactionId: buyerTx.id,
      listingId: listing.id,
      buyerId,
      sellerId: listing.seller_id,
      amount: listing.price,
      currency: listing.currency,
    });

    return {
      success: true,
      transactionId: buyerTx.id,
      escrowId: escrow.escrowId,
      platformFee: escrow.platformFee,
      sellerAmount: escrow.sellerAmount,
      message: 'Payment held in escrow. Funds will be released to the seller after you confirm delivery.',
    };
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

      const quantity = item.quantity || 1;
      listings.push({ listing, quantity });
      totalAmount += Number(listing.price) * quantity;
    }

    const PaymentService = require('./PaymentService');
    const PaystackService = require('./PaystackService');
    const reference = PaystackService.generateReference('BUL');

    // Create transactions for each listing sharing the same reference
    for (const { listing, quantity } of listings) {
      const amount = Number(listing.price) * quantity;
      const buyerTx = await PaymentService.createTransaction(
        buyerId, amount, 'marketplace_purchase', listing.id, 'marketplace_listing'
      );
      await Database.update('transactions', { reference, updated_at: new Date() }, 'id = ?', [buyerTx.id]);
    }

    // Initialize single Paystack payment for the total
    const paystack = await PaymentService.initializePaystackPayment({
      userId: buyerId,
      email: buyer.email,
      amount: totalAmount,
      reference,
      listingId: null,
      metadata: { item_count: items.length, transaction_count: listings.length },
    });

    return {
      success: true,
      reference,
      authorizationUrl: paystack.authorizationUrl,
      accessCode: paystack.accessCode,
      amount: totalAmount,
      message: 'Redirect to Paystack to complete payment.',
    };
  }

  // Bulk: complete purchase for all listings in a cart order
  static async bulkCompletePurchase(reference) {
    const PaymentService = require('./PaymentService');
    const EscrowService = require('./EscrowService');

    // Find all transactions with this reference
    const buyerTxs = await Database.select('transactions', '*', 'reference = ?', [reference]);
    if (!buyerTxs || buyerTxs.length === 0) throw new Error('No transactions found for this reference');

    if (buyerTxs.some(tx => tx.status === 'completed')) throw new Error('Transaction already completed');

    // Verify payment with Paystack
    const verification = await PaymentService.verifyPaystackPayment(reference);
    if (!verification.verified) throw new Error('Payment not confirmed');

    const buyerId = buyerTxs[0].user_id;
    const results = [];

    for (const buyerTx of buyerTxs) {
      const listing = await Database.selectOne('marketplace_listings', '*', 'id = ?', [buyerTx.related_entity_id]);
      if (!listing) throw new Error('Listing not found');
      if (listing.status !== 'active') throw new Error(`Listing "${listing.title}" is no longer available`);

      // Mark transaction completed
      await Database.update('transactions', {
        status: 'completed',
        updated_at: new Date(),
      }, 'id = ?', [buyerTx.id]);

      // Transfer device ownership
      await Database.update('devices', { user_id: buyerId, updated_at: new Date() }, 'id = ?', [listing.device_id]);

      // Close listing
      await Database.update('marketplace_listings', {
        status: 'sold', buyer_id: buyerId, sold_at: new Date(), updated_at: new Date(),
      }, 'id = ?', [listing.id]);

      // Hold funds in escrow
      const escrow = await EscrowService.holdFunds({
        transactionId: buyerTx.id,
        listingId: listing.id,
        buyerId,
        sellerId: listing.seller_id,
        amount: buyerTx.amount,
        currency: listing.currency,
      });

      results.push({
        transactionId: buyerTx.id,
        listingId: listing.id,
        escrowId: escrow.escrowId,
        platformFee: escrow.platformFee,
        sellerAmount: escrow.sellerAmount,
      });
    }

    return {
      success: true,
      results,
      message: 'Payment held in escrow. Funds will be released to the seller after you confirm delivery.',
    };
  }

  // Legacy: direct purchase with simulated payment (for testing without Paystack)
  static async purchaseListing(buyerId, listingId, paymentMethodId) {
    const listing = await Database.selectOne('marketplace_listings', '*', 'id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing is no longer available');
    if (listing.seller_id === buyerId) throw new Error('Cannot buy your own listing');

    const PaymentService = require('./PaymentService');
    const buyer = await Database.selectOne('users', 'email, name', 'id = ?', [buyerId]);
    if (!buyer) throw new Error('Buyer not found');

    const reference = PaystackService.generateReference('MAN');

    const buyerTx = await PaymentService.createTransaction(
      buyerId, listing.price, 'marketplace_purchase', listingId, 'marketplace_listing'
    );

    // Mark completed immediately (simulated)
    await Database.update('transactions', { status: 'completed', reference, updated_at: new Date() }, 'id = ?', [buyerTx.id]);

    await Database.update('devices', { user_id: buyerId, updated_at: new Date() }, 'id = ?', [listing.device_id]);
    await Database.update('marketplace_listings', {
      status: 'sold', buyer_id: buyerId, sold_at: new Date(), updated_at: new Date(),
    }, 'id = ?', [listingId]);

    const EscrowService = require('./EscrowService');
    const escrow = await EscrowService.holdFunds({
      transactionId: buyerTx.id, listingId, buyerId, sellerId: listing.seller_id,
      amount: listing.price, currency: listing.currency,
    });

    return {
      success: true, transactionId: buyerTx.id, escrowId: escrow.escrowId,
      platformFee: escrow.platformFee, sellerAmount: escrow.sellerAmount,
      message: 'Payment held in escrow. Funds will be released to the seller after you confirm delivery.',
    };
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
      SELECT l.*, d.brand, d.model, d.category, u.name as seller_name, u.kyc_status as seller_verified, u.email as seller_email
      FROM marketplace_listings l
      JOIN devices d ON l.device_id = d.id
      JOIN users u ON l.seller_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (l.title LIKE ? OR l.description LIKE ? OR d.brand LIKE ? OR d.model LIKE ? OR u.email LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
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

  static async getSellerOrders(userId) {
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
      `;
      const orders = await Database.query(sql, [userId]);
      return orders.map(o => ({
          ...o,
          images: typeof o.images === 'string' ? JSON.parse(o.images) : o.images
      }));
  }
}

module.exports = MarketplaceService;
