-- Migration: Add missing columns for business payout and transaction descriptions
-- Fixes gaps between backend code and database schema

-- 1. Add payout columns to users table (needed by business-onboarding.js)
ALTER TABLE users ADD COLUMN payout_bank_name VARCHAR(255) DEFAULT NULL AFTER updated_at;
ALTER TABLE users ADD COLUMN payout_account_number VARCHAR(20) DEFAULT NULL AFTER payout_bank_name;
ALTER TABLE users ADD COLUMN payout_account_name VARCHAR(255) DEFAULT NULL AFTER payout_account_number;

-- 2. Add description column to transactions table (needed by RevenueService.js)
ALTER TABLE transactions ADD COLUMN description TEXT DEFAULT NULL AFTER reference;
