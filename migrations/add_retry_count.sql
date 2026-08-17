-- Add retry_count column to notifications table
-- Run this if you already have the database created

USE check_it_registry;

-- Add retry_count column if it doesn't exist
ALTER TABLE notifications 
ADD COLUMN retry_count INT DEFAULT 0 COMMENT 'Number of retry attempts' 
AFTER error_message;

-- Show the updated table structure
DESCRIBE notifications;