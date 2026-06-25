const db = require('../config');
(async () => {
  const listings = await db.query(`
    SELECT l.*, d.brand, d.model, d.category, u.name as seller_name, u.kyc_status as seller_verified
    FROM marketplace_listings l
    JOIN devices d ON l.device_id = d.id
    JOIN users u ON l.seller_id = u.id
    WHERE l.status = 'active'
    ORDER BY l.created_at DESC
    LIMIT 5
  `);
  console.log('Listings count:', listings.length);
  if (listings.length) console.log('Sample:', listings[0].title, 'cat:', listings[0].category);
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
