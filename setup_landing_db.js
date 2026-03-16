const Database = require('./config');

async function setup() {
    try {
        console.log('Setting up landing_content table...');
        
        // Create table
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
        console.log('Table created or already exists.');

        // Insert default data if empty
        const audit = await Database.query('SELECT COUNT(*) as count FROM landing_content');
        if (audit[0].count === 0) {
            console.log('Inserting default data...');
            const defaults = [
                // Team
                {
                    type: 'team',
                    name: 'Sarah Okonjo',
                    role: 'Chief Executive Officer',
                    image_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?ixlib=rb-1.2.1&auto=format&fit=crop&w=634&q=80',
                    content: 'Former cybersecurity consultant with a vision to digitize asset protection in Africa.',
                    display_order: 1
                },
                {
                    type: 'team',
                    name: 'David Adeleke',
                    role: 'Head of Engineering',
                    image_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?ixlib=rb-1.2.1&auto=format&fit=crop&w=634&q=80',
                    content: 'Systems architect ensuring our platform scales securely and reliably.',
                    display_order: 2
                },
                // Testimonials
                {
                    type: 'testimonial',
                    name: 'Emmanuel K.',
                    role: 'Verified User',
                    content: 'I recovered my stolen laptop within 48 hours thanks to the registry. The police were able to flag it immediately!',
                    display_order: 1
                }
            ];

            for (const d of defaults) {
                await Database.insert('landing_content', d);
            }
            console.log('Default data inserted.');
        } else {
            console.log('Table already has data, skipping defaults.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Setup failed:', err);
        process.exit(1);
    }
}

setup();
