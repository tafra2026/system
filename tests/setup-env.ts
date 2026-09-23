import { config } from 'dotenv'

config({ path: '.env', quiet: true })
// Integration tests must never touch the development/production database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.APP_ENV = 'test'
