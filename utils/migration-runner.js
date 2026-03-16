// Database Migration Runner
const fs = require('fs').promises;
const path = require('path');
const Database = require('../config');

class MigrationRunner {
  constructor() {
    this.migrationsPath = path.join(__dirname, '../migrations');
  }

  async createMigrationsTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64),
        INDEX idx_filename (filename),
        INDEX idx_executed_at (executed_at)
      )
    `;
    
    await Database.query(createTableSQL);
    console.log('✅ Migrations table created/verified');
  }

  async getMigrationChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async hasBeenExecuted(filename) {
    try {
      const result = await Database.selectOne(
        'migrations',
        'id, checksum',
        'filename = ?',
        [filename]
      );
      return result;
    } catch (error) {
      return null;
    }
  }

  async recordMigration(filename, checksum) {
    await Database.insert('migrations', {
      filename,
      checksum,
      executed_at: new Date()
    });
  }

  async executeSQLFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const checksum = await this.getMigrationChecksum(content);
      const filename = path.basename(filePath);

      // Check if already executed
      const existing = await this.hasBeenExecuted(filename);
      if (existing) {
        if (existing.checksum === checksum) {
          console.log(`⏭️  Migration ${filename} already executed (checksum match)`);
          return { success: true, skipped: true };
        } else {
          console.log(`⚠️  Migration ${filename} has different checksum - re-executing`);
        }
      }

      console.log(`🔄 Executing migration: ${filename}`);

      // Split SQL content by statements (handle DELIMITER changes)
      const statements = this.parseSQLStatements(content);
      
      let executedStatements = 0;
      const errors = [];

      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await Database.query(statement);
            executedStatements++;
          } catch (error) {
            // Some errors are expected (like IF NOT EXISTS when item already exists)
            if (this.isExpectedError(error)) {
              console.log(`ℹ️  Expected condition: ${error.message}`);
              executedStatements++;
            } else {
              console.error(`❌ Error executing statement: ${error.message}`);
              console.error(`Statement: ${statement.substring(0, 100)}...`);
              errors.push({ statement: statement.substring(0, 100), error: error.message });
            }
          }
        }
      }

      // Record the migration
      if (existing) {
        await Database.query('UPDATE migrations SET checksum = ?, executed_at = NOW() WHERE filename = ?', [checksum, filename]);
      } else {
        await this.recordMigration(filename, checksum);
      }

      console.log(`✅ Migration ${filename} completed: ${executedStatements} statements executed`);
      
      if (errors.length > 0) {
        console.log(`⚠️  ${errors.length} non-critical errors encountered`);
      }

      return { 
        success: true, 
        skipped: false, 
        statementsExecuted: executedStatements,
        errors: errors
      };

    } catch (error) {
      console.error(`❌ Failed to execute migration ${filePath}:`, error);
      return { success: false, error: error.message };
    }
  }

  parseSQLStatements(content) {
    // Handle DELIMITER changes and split statements properly
    const lines = content.split('\n');
    const statements = [];
    let currentStatement = '';
    let delimiter = ';';
    let inDelimiterBlock = false;

    for (let line of lines) {
      line = line.trim();
      
      // Skip comments and empty lines
      if (line.startsWith('--') || line.startsWith('#') || !line) {
        continue;
      }

      // Handle DELIMITER changes
      if (line.toUpperCase().startsWith('DELIMITER')) {
        const newDelimiter = line.split(/\s+/)[1];
        if (newDelimiter === '//') {
          delimiter = '//';
          inDelimiterBlock = true;
        } else if (newDelimiter === ';') {
          delimiter = ';';
          inDelimiterBlock = false;
        }
        continue;
      }

      currentStatement += line + '\n';

      // Check if statement is complete
      if (line.endsWith(delimiter)) {
        // Remove the delimiter from the end
        currentStatement = currentStatement.slice(0, -delimiter.length - 1).trim();
        if (currentStatement) {
          statements.push(currentStatement);
        }
        currentStatement = '';
      }
    }

    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    return statements;
  }

  isExpectedError(error) {
    const expectedMessages = [
      'already exists',
      'Duplicate column name',
      'Duplicate key name',
      'Duplicate entry',
      'Column already exists',
      'Key already exists'
    ];

    return expectedMessages.some(msg => 
      error.message.includes(msg) || 
      error.sqlMessage?.includes(msg)
    );
  }

  async runMigration(migrationFile) {
    try {
      await this.createMigrationsTable();
      
      const filePath = path.join(this.migrationsPath, migrationFile);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        throw new Error(`Migration file not found: ${migrationFile}`);
      }

      const result = await this.executeSQLFile(filePath);
      return result;

    } catch (error) {
      console.error('Migration runner error:', error);
      throw error;
    }
  }

  async runAllMigrations() {
    try {
      await this.createMigrationsTable();
      
      const files = await fs.readdir(this.migrationsPath);
      const sqlFiles = files.filter(file => file.endsWith('.sql')).sort();

      console.log(`📁 Found ${sqlFiles.length} migration files`);

      const results = [];
      for (const file of sqlFiles) {
        const filePath = path.join(this.migrationsPath, file);
        const result = await this.executeSQLFile(filePath);
        results.push({ file, ...result });
      }

      return results;

    } catch (error) {
      console.error('Migration runner error:', error);
      throw error;
    }
  }

  async getMigrationStatus() {
    try {
      await this.createMigrationsTable();
      
      const executed = await Database.select(
        'migrations',
        'filename, executed_at, checksum',
        null,
        [],
        'executed_at DESC'
      );

      const files = await fs.readdir(this.migrationsPath);
      const sqlFiles = files.filter(file => file.endsWith('.sql')).sort();

      const status = sqlFiles.map(file => {
        const migration = executed.find(m => m.filename === file);
        return {
          filename: file,
          executed: !!migration,
          executedAt: migration?.executed_at || null,
          checksum: migration?.checksum || null
        };
      });

      return status;

    } catch (error) {
      console.error('Error getting migration status:', error);
      throw error;
    }
  }
}

module.exports = MigrationRunner;