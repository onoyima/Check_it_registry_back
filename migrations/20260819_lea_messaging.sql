-- Migration: LEA Messaging System
-- Creates threads, participants, and messages tables for LEA-LEA / LEA-user communication

CREATE TABLE IF NOT EXISTS lea_threads (
  id VARCHAR(36) PRIMARY KEY,
  subject VARCHAR(255) NOT NULL,
  case_id VARCHAR(36) DEFAULT NULL,
  status ENUM('active', 'archived', 'closed') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_case_id (case_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lea_thread_participants (
  id VARCHAR(36) PRIMARY KEY,
  thread_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role ENUM('lea', 'member', 'admin') DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_read_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY unique_thread_user (thread_id, user_id),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (thread_id) REFERENCES lea_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lea_thread_messages (
  id VARCHAR(36) PRIMARY KEY,
  thread_id VARCHAR(36) NOT NULL,
  sender_id VARCHAR(36) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_thread_id (thread_id),
  INDEX idx_sender_id (sender_id),
  FOREIGN KEY (thread_id) REFERENCES lea_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
