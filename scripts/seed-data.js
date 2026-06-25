// Comprehensive database seed script
// Run: node scripts/seed-data.js

const crypto = require('crypto');
const db = require('../config');
const uuidv4 = () => crypto.randomUUID();

const USER_IDS = {
  business: '81cb0d4c-2702-4b62-97ce-898acf805cc3', // janeeva132@gmail.com
  clinton: 'ae69a974-d7f8-4005-8ebd-08304989e507', // www.clintonboniface@gmail.com
  admin: '9fcb77ae-4585-4f62-b01d-11979c33f6a7', // clintonfaze@gmail.com
  lea: '366b82a3-6953-4451-ad5f-acfd60ffb314', // janeevamich@gmail.com
  seller: 'a69fb594-053f-4aef-9112-16ff38220a91', // test_seller@example.com
  test2: '6829e75e-f1f3-44f2-b9b2-d1f0d98fa53b', // test2@test.com
  testopen: 'd845eb6e-8d96-4e4f-a6f2-7f00575ec1f9', // test.opencode@example.com
  leatest: '1973c0f1-5276-40d7-89c4-03927ab686f0', // test.device3.20251102190710@example.com
  checkit: '8bdfb698-aaa8-4541-ac19-8ba100f8498d', // admin@checkit.com
};

async function seed() {
  console.log('Starting seed...\n');

  const deviceIds = await createDevices();
  await createMarketplaceListings(deviceIds);
  await createTransfer(deviceIds);
  await createMessages(deviceIds);

  console.log('\nSeed complete!');
  process.exit(0);
}

async function createDevices() {
  console.log('Creating devices...');
  const deviceIds = [];

  const deviceData = [
    { user_id: USER_IDS.business, brand: 'Apple', model: 'iPhone 15 Pro Max', category: 'mobile_phone', status: 'verified', imei: '356938123456789', color: 'Natural Titanium', storage: '256GB' },
    { user_id: USER_IDS.business, brand: 'Apple', model: 'MacBook Pro 16 M3', category: 'computer', status: 'verified', serial: 'MBP16M3-001', color: 'Space Black', storage: '1TB' },
    { user_id: USER_IDS.business, brand: 'Samsung', model: 'Galaxy S24 Ultra', category: 'mobile_phone', status: 'verified', imei: '352689123456780', color: 'Titanium Gray', storage: '512GB' },
    { user_id: USER_IDS.clinton, brand: 'Dell', model: 'XPS 15', category: 'computer', status: 'verified', serial: 'XPS15-2023-002', color: 'Silver', storage: '512GB' },
    { user_id: USER_IDS.clinton, brand: 'Sony', model: 'PlayStation 5', category: 'electronics', status: 'verified', serial: 'PS5-DISC-003', notes: 'Includes 2 controllers' },
    { user_id: USER_IDS.seller, brand: 'Apple', model: 'iPad Pro 12.9', category: 'electronics', status: 'verified', serial: 'IPDPRO-004', color: 'Space Gray', storage: '256GB' },
    { user_id: USER_IDS.seller, brand: 'Samsung', model: 'Galaxy Watch 6', category: 'electronics', status: 'verified', imei: '359871234567812', color: 'Graphite' },
    { user_id: USER_IDS.seller, brand: 'Canon', model: 'EOS R5', category: 'electronics', status: 'verified', serial: 'EOSR5-005', notes: 'Shutter count under 5000' },
    { user_id: USER_IDS.admin, brand: 'Apple', model: 'iPhone 14 Pro', category: 'mobile_phone', status: 'verified', imei: '351234567890123', color: 'Deep Purple', storage: '128GB' },
    { user_id: USER_IDS.admin, brand: 'HP', model: 'Spectre x360', category: 'computer', status: 'unverified', serial: 'SPECTRE-006', color: 'Nightfall Black', storage: '512GB' },
    { user_id: USER_IDS.lea, brand: 'Google', model: 'Pixel 8 Pro', category: 'mobile_phone', status: 'verified', imei: '357654321098765', color: 'Obsidian', storage: '128GB' },
    { user_id: USER_IDS.test2, brand: 'Microsoft', model: 'Surface Pro 9', category: 'electronics', status: 'unverified', serial: 'SURFACEPRO-007', color: 'Platinum', storage: '256GB' },
    { user_id: USER_IDS.leatest, brand: 'Nokia', model: '3310', category: 'mobile_phone', status: 'verified', imei: '358901234567890', color: 'Blue' },
  ];

  for (const d of deviceData) {
    let existing = null;
    if (d.imei) {
      const rows = await db.query('SELECT id FROM devices WHERE imei = ?', [d.imei]);
      if (rows.length) existing = rows[0].id;
    } else if (d.serial) {
      const rows = await db.query('SELECT id FROM devices WHERE serial = ?', [d.serial]);
      if (rows.length) existing = rows[0].id;
    }
    const id = existing || uuidv4();
    if (!existing) {
      await db.query(
        `INSERT INTO devices (id, user_id, brand, model, category, status, imei, serial, color, storage_capacity, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, d.user_id, d.brand, d.model, d.category, d.status,
         d.imei || null, d.serial || null, d.color || null,
         d.storage || null, d.notes || null]
      );
    } else {
      await db.query('UPDATE devices SET updated_at = NOW() WHERE id = ?', [id]);
    }
    deviceIds.push(id);
    console.log('  ' + d.brand + ' ' + d.model + ' (' + d.status + ')');
  }

  return deviceIds;
}

async function createMarketplaceListings(deviceIds) {
  console.log('\n🏪 Creating marketplace listings...');

  const categories = ['Smartphone', 'Laptop', 'Gaming', 'Tablet', 'Wearable', 'Camera'];
  const conditions = ['new', 'used', 'refurbished'];
  const locations = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu', 'Benin City'];
  const currencies = ['NGN', 'USD'];

  // Seller devices (verified devices belonging to sellers)
  const sellerDeviceIds = [
    { did: deviceIds[0], seller: USER_IDS.business, brand: 'Apple iPhone 15 Pro Max' },
    { did: deviceIds[2], seller: USER_IDS.business, brand: 'Samsung Galaxy S24 Ultra' },
    { did: deviceIds[1], seller: USER_IDS.business, brand: 'Apple MacBook Pro 16"' },
    { did: deviceIds[3], seller: USER_IDS.clinton, brand: 'Dell XPS 15' },
    { did: deviceIds[5], seller: USER_IDS.seller, brand: 'Apple iPad Pro 12.9"' },
    { did: deviceIds[6], seller: USER_IDS.seller, brand: 'Samsung Galaxy Watch 6' },
    { did: deviceIds[7], seller: USER_IDS.seller, brand: 'Canon EOS R5' },
    { did: deviceIds[8], seller: USER_IDS.admin, brand: 'Apple iPhone 14 Pro' },
    { did: deviceIds[10], seller: USER_IDS.lea, brand: 'Google Pixel 8 Pro' },
    { did: deviceIds[4], seller: USER_IDS.clinton, brand: 'Sony PlayStation 5' },
  ];

  const listingImages = [
    'https://images.unsplash.com/photo-1592899677977-9c10a5889d4e?w=400',  // iPhone 15 Pro Max
    'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=400',  // Galaxy S24 Ultra
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400',  // MacBook Pro
    'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=400',  // Dell XPS
    'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400',    // iPad Pro
    'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=400', // Galaxy Watch
    'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400', // Canon EOS R5
    'https://images.unsplash.com/photo-1596728325488-58c87691e9af?w=400', // iPhone 14 Pro
    'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=400', // Pixel 8 Pro
    'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=400', // PS5
    'https://images.unsplash.com/photo-1592899677977-9c10a5889d4e?w=400', // iPhone 15 Pro Max (duplicate)
    'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=400', // Galaxy S24 Ultra (duplicate)
  ];

  const listingData = [
    { title: 'Apple iPhone 15 Pro Max 256GB - Natural Titanium', desc: 'Brand new, sealed. Purchased but never used. Unlocked UK version with full warranty.', price: 1850000, condition: 'new', location: 'Lagos', currency: 'NGN' },
    { title: 'Samsung Galaxy S24 Ultra 512GB - Titanium Gray', desc: 'Brand new, unopened box. Original Samsung warranty included. Dual SIM.', price: 1650000, condition: 'new', location: 'Abuja', currency: 'NGN' },
    { title: 'MacBook Pro 16" M3 Max - 1TB SSD', desc: 'Latest model with M3 Max chip. 36GB RAM, 1TB SSD. Space Black. Barely used for a week.', price: 4200000, condition: 'new', location: 'Lagos', currency: 'NGN' },
    { title: 'Dell XPS 15 OLED - Core i9 13th Gen', desc: 'Excellent condition. 32GB RAM, 512GB SSD, OLED touch display. Used for 6 months.', price: 850000, condition: 'used', location: 'Port Harcourt', currency: 'NGN' },
    { title: 'Apple iPad Pro 12.9" M2 - 256GB WiFi + Cellular', desc: 'Brand new, factory sealed. Space Gray. Includes charger and cable.', price: 950000, condition: 'new', location: 'Ibadan', currency: 'NGN' },
    { title: 'Samsung Galaxy Watch 6 44mm - LTE', desc: 'Brand new, never worn. Graphite color with extra bands included.', price: 280000, condition: 'new', location: 'Lagos', currency: 'NGN' },
    { title: 'Canon EOS R5 Mirrorless Camera', desc: 'Professional grade camera. Shutter count under 5000. Includes 24-105mm lens kit.', price: 3200000, condition: 'used', location: 'Enugu', currency: 'NGN' },
    { title: 'Apple iPhone 14 Pro 128GB - Deep Purple', desc: 'Refurbished by Apple. New battery, new display. 1 year warranty. Excellent condition.', price: 680000, condition: 'refurbished', location: 'Lagos', currency: 'NGN' },
    { title: 'Google Pixel 8 Pro 128GB - Obsidian', desc: 'Brand new, sealed. Best camera phone of 2024. Includes Pixel Buds Pro as bonus.', price: 750000, condition: 'new', location: 'Benin City', currency: 'NGN' },
    { title: 'Sony PlayStation 5 Disc Edition', desc: 'Barely used. Includes 2 controllers, charging dock, and 3 games (Spider-Man 2, God of War, FIFA 24).', price: 520000, condition: 'used', location: 'Kano', currency: 'NGN' },
    { title: 'Apple iPhone 15 Pro Max - Factory Price', desc: 'Special discounted price for quick sale. Brand new, sealed. Full warranty.', price: 1500000, condition: 'new', location: 'Abuja', currency: 'NGN' },
    { title: 'Samsung Galaxy S24 Ultra - Like New', desc: 'Used for 2 weeks only. No scratches, no issues. Comes with original box and charger.', price: 1200000, condition: 'used', location: 'Lagos', currency: 'NGN' },
  ];

  for (let i = 0; i < listingData.length; i++) {
    const item = listingData[i];
    const sd = sellerDeviceIds[i % sellerDeviceIds.length];
    const images = JSON.stringify([listingImages[i % listingImages.length]]);
    const daysAgo = Math.floor(Math.random() * 14);

    const existing = await db.query('SELECT id FROM marketplace_listings WHERE title = ?', [item.title]);
    if (existing.length) {
      await db.query(
        `UPDATE marketplace_listings SET price = ?, description = ?, device_condition = ?, location = ?, images = ?, updated_at = NOW() WHERE id = ?`,
        [item.price, item.desc, item.condition, item.location, images, existing[0].id]
      );
      console.log('  [*' + (i + 1) + '] ' + item.title + ' - NGN ' + item.price.toLocaleString() + ' (updated)');
      continue;
    }

    const id = uuidv4();
    await db.query(
      `INSERT INTO marketplace_listings (id, seller_id, device_id, title, description, price, currency, device_condition, status, location, images, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY), NOW())`,
      [id, sd.seller, sd.did, item.title, item.desc, item.price, item.currency, item.condition,
       'active', item.location, images, i < 3 ? 1 : 0, daysAgo]
    );
    console.log('  [' + (i + 1) + '] ' + item.title + ' - NGN ' + item.price.toLocaleString());
  }

  console.log('  Total: ' + listingData.length + ' marketplace listings created');
}

async function createTransfer(deviceIds) {
  console.log('\n🔄 Creating transfer records...');

  const transferCode = 'TRF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const existingTransfer = await db.query('SELECT id FROM device_transfers WHERE device_id = ? AND from_user_id = ? AND to_user_id = ?', [deviceIds[0], USER_IDS.business, USER_IDS.clinton]);
  if (!existingTransfer.length) {
    const transferId = uuidv4();
    await db.query(
      `INSERT INTO device_transfers (id, device_id, from_user_id, to_user_id, transfer_code, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW(), NOW())`,
      [transferId, deviceIds[0], USER_IDS.business, USER_IDS.clinton, transferCode, 'accepted']
    );
    console.log('  ✅ Legacy transfer created (Business → Clinton)');
  } else {
    console.log('  ℹ️ Transfer already exists');
  }

  const existingTxn = await db.query('SELECT id FROM transactions WHERE user_id = ? AND amount = 950000 AND type = ?', [USER_IDS.seller, 'marketplace_purchase']);
  if (!existingTxn.length) {
    const txnId = uuidv4();
    await db.query(
      `INSERT INTO transactions (id, user_id, amount, currency, type, status, reference, related_entity_type, related_entity_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [txnId, USER_IDS.seller, 950000, 'NGN', 'marketplace_purchase', 'completed',
       'TXN-' + Math.random().toString(36).substring(2, 10).toUpperCase(), 'listing', uuidv4()]
    );
    console.log('  ✅ Sample transaction created');
  } else {
    console.log('  ℹ️ Transaction already exists');
  }
}

async function createMessages(deviceIds) {
  console.log('\n💬 Creating marketplace messages...');

  const messages = [
    { sender: USER_IDS.clinton, receiver: USER_IDS.business, listing_idx: 0, text: 'Hello, is the iPhone 15 Pro Max still available?' },
    { sender: USER_IDS.business, receiver: USER_IDS.clinton, listing_idx: 0, text: 'Yes, it is still available. Would you like to negotiate the price?' },
    { sender: USER_IDS.clinton, receiver: USER_IDS.business, listing_idx: 0, text: 'Can you do ₦1,700,000 if I pick it up today?' },
    { sender: USER_IDS.business, receiver: USER_IDS.clinton, listing_idx: 0, text: 'Best I can do is ₦1,800,000 since it is brand new. I can deliver within Lagos.' },
    { sender: USER_IDS.testopen, receiver: USER_IDS.seller, listing_idx: 4, text: 'Hi, I am interested in the iPad Pro. Is it still available?' },
    { sender: USER_IDS.seller, receiver: USER_IDS.testopen, listing_idx: 4, text: 'Yes it is! I can offer free delivery within Ibadan.' },
  ];

  // Get a listing ID
  const listings = await db.query('SELECT id, seller_id FROM marketplace_listings LIMIT 10');
  if (listings.length === 0) {
    console.log('  ⚠ No listings found, skipping messages');
    return;
  }

  for (const msg of messages) {
    const listingId = listings[msg.listing_idx].id;
    const receiverId = msg.receiver;
    const existingMsg = await db.query(
      'SELECT id FROM marketplace_messages WHERE listing_id = ? AND sender_id = ? AND content = ?',
      [listingId, msg.sender, msg.text]
    );
    if (existingMsg.length) continue;

    const id = uuidv4();
    await db.query(
      `INSERT INTO marketplace_messages (id, listing_id, sender_id, receiver_id, content, created_at)
       VALUES (?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? HOUR))`,
      [id, listingId, msg.sender, receiverId, msg.text, Math.floor(Math.random() * 48)]
    );
  }
  console.log(`  ✅ ${messages.length} messages created`);
}

seed().catch(e => {
  console.error('\n❌ Seed failed:', e.message, e.stack?.substring(0, 300));
  process.exit(1);
});
