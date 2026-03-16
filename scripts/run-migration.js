// Simple migration runner to execute a single SQL file against MySQL
// Usage: node server/scripts/run-migration.js --file server/migrations/add_device_checks.sql

const fs = require('fs')
const path = require('path')
const Database = require('../config')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--file' || a === '-f') {
      out.file = args[i + 1]
      i++
    } else if (a === '--dry-run') {
      out.dryRun = true
    }
  }
  return out
}

async function run() {
  try {
    const { file, dryRun } = parseArgs()
    if (!file) {
      console.error('Missing --file argument. Example: --file server/migrations/add_device_checks.sql')
      process.exit(1)
    }
    const fullPath = path.resolve(process.cwd(), file)
    if (!fs.existsSync(fullPath)) {
      console.error(`File not found: ${fullPath}`)
      process.exit(1)
    }
    const sqlRaw = fs.readFileSync(fullPath, 'utf8')
    // Split by semicolons, keep statements simple; ignore empty lines
    const statements = sqlRaw
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    console.log(`Running migration: ${path.basename(fullPath)} (${statements.length} statements)`) 
    if (dryRun) {
      console.log('Dry run: statements parsed but not executed.')
      process.exit(0)
    }

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      try {
        await Database.query(stmt)
        console.log(`✔ Executed [${i + 1}/${statements.length}]`)
      } catch (err) {
        console.error(`✖ Failed at statement [${i + 1}]`, err.message)
        throw err
      }
    }
    console.log('✅ Migration completed successfully')
    process.exit(0)
  } catch (err) {
    console.error('❌ Migration failed:', err)
    process.exit(1)
  }
}

run()