const Database = require('../config');

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
      brand, 
      location, 
      limit = 20, 
      offset = 0 
    } = filters;

    let sql = `
      SELECT l.*, d.brand, d.model, u.name as seller_name, u.kyc_status as seller_verified
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
      SELECT l.*, d.brand, d.model, d.storage_capacity, d.color, u.name as seller_name, u.kyc_status as seller_verified, u.id as seller_id
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
  static async purchaseListing(buyerId, listingId, paymentMethodId) {
    const listing = await Database.selectOne('marketplace_listings', '*', 'id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'active') throw new Error('Listing is no longer available');
    if (listing.seller_id === buyerId) throw new Error('Cannot buy your own listing');

    // 1. Process Payment
    const PaymentService = require('./PaymentService');
    // Verify payment method belongs to buyer
    const method = await Database.selectOne('payment_methods', 'id', 'id = ? AND user_id = ?', [paymentMethodId, buyerId]);
    if (!method) throw new Error('Invalid payment method');

    // Create pending debit transaction for buyer
    const buyerTx = await PaymentService.createTransaction(buyerId, listing.price, 'marketplace_purchase', listingId, 'marketplace_listing');
    
    // Process the charge
    try {
        await PaymentService.processPayment(buyerId, listing.price, paymentMethodId);
        // Update buyer tx status
        await Database.update('transactions', { status: 'completed', updated_at: new Date() }, 'id = ?', [buyerTx.id]);
    } catch (err) {
        await Database.update('transactions', { status: 'failed', updated_at: new Date() }, 'id = ?', [buyerTx.id]);
        throw err;
    }

    // 2. Transfer Ownership
    // Update device owner to buyer
    await Database.update('devices', { user_id: buyerId, updated_at: new Date() }, 'id = ?', [listing.device_id]);

    // 3. Close Listing
    await Database.update('marketplace_listings', { status: 'sold', buyer_id: buyerId, sold_at: new Date(), updated_at: new Date() }, 'id = ?', [listingId]);

    // 4. Credit Seller (Create accessible balance transaction)
    // In a real system, this would go to a 'wallet' balance. Here we just record the credit transaction.
    // Calculate platform fee (e.g., 5%)
    const fee = listing.price * 0.05;
    const netAmount = listing.price - fee;

    await Database.insert('transactions', {
        id: Database.generateUUID(),
        user_id: listing.seller_id,
        amount: netAmount,
        currency: listing.currency,
        type: 'marketplace_sale',
        status: 'completed', // Immediately available for withdrawal logic
        related_entity_type: 'marketplace_listing',
        related_entity_id: listingId,
        created_at: new Date(),
        updated_at: new Date()
    });

    return { success: true, transactionId: buyerTx.id };
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
      SELECT l.*, d.brand, d.model, u.name as seller_name, u.kyc_status as seller_verified, u.email as seller_email
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

     return {
         activeListings: activeListings[0].count,
         soldListings: soldListings[0].count,
         revenue: totalRevenue[0].total || 0,
         totalDevices: totalDevices[0].count
     };
  }

  static async getSellerOrders(userId) {
      const sql = `
        SELECT l.*, d.brand, d.model, b.name as buyer_name, b.email as buyer_email
        FROM marketplace_listings l
        JOIN devices d ON l.device_id = d.id
        LEFT JOIN users b ON l.buyer_id = b.id
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
