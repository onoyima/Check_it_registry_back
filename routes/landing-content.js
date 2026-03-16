const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const Database = require('../config');

const router = express.Router();

// Initialize table if not exists (Basic simplified migration)
// Ideally this should be identifying if table exists, but for now we'll just try to create it if we can't select from it
router.use(async (req, res, next) => {
    // Only run this check occasionally or assumes it's created. 
    // Ideally put in a separate migration script.
    // For this environment, we'll skip auto-creation on every request to avoid overhead.
    next();
});

// Setup endpoint (Admin can call this once to init)
router.post('/setup', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await Database.query(`
            CREATE TABLE IF NOT EXISTS landing_content (
                id INT AUTO_INCREMENT PRIMARY KEY,
                type ENUM('team', 'testimonial') NOT NULL,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(255) NOT NULL,
                image_url TEXT,
                content TEXT,
                display_order INT DEFAULT 0,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        res.json({ success: true, message: 'Landing content table setup complete' });
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Setup failed' });
    }
});

// GET / - Public fetch of landing content
router.get('/', async (req, res) => {
    try {
        const content = await Database.query(`
            SELECT * FROM landing_content 
            WHERE active = TRUE 
            ORDER BY display_order ASC, created_at DESC
        `);
        
        const team = content.filter(c => c.type === 'team');
        const testimonials = content.filter(c => c.type === 'testimonial');
        
        res.json({ team, testimonials });
    } catch (error) {
        console.error('Fetch landing content error:', error);
        // Return defaults if DB is empty or error
        res.json({
            team: [],
            testimonials: []
        });
    }
});

// GET /all - Admin fetch (including inactive)
router.get('/all', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const content = await Database.query(`
            SELECT * FROM landing_content 
            ORDER BY type, display_order ASC, created_at DESC
        `);
        res.json(content);
    } catch (error) {
        console.error('Fetch all content error:', error);
        res.status(500).json({ error: 'Failed to fetch content' });
    }
});

// POST / - Add new content
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { type, name, role, image_url, content, display_order, active } = req.body;
        
        if (!['team', 'testimonial'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type' });
        }

        const result = await Database.insert('landing_content', {
            type, name, role, image_url, content, display_order: display_order || 0, active: !!active
        });

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Add content error:', error);
        res.status(500).json({ error: 'Failed to add content' });
    }
});

// PUT /:id - Update content
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Remove protected fields
        delete updates.id;
        delete updates.created_at;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        await Database.update('landing_content', updates, 'id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Update content error:', error);
        res.status(500).json({ error: 'Failed to update content' });
    }
});

// DELETE /:id - Delete content
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await Database.delete('landing_content', 'id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete content error:', error);
        res.status(500).json({ error: 'Failed to delete content' });
    }
});

module.exports = router;
