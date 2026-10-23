-- MariaDB dump 10.19  Distrib 10.4.32-MariaDB, for Win64 (AMD64)
--
-- Host: localhost    Database: check_it_registry
-- ------------------------------------------------------
-- Server version	10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `_migrations`
--

DROP TABLE IF EXISTS `_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `_migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `run_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `_migrations`
--

LOCK TABLES `_migrations` WRITE;
/*!40000 ALTER TABLE `_migrations` DISABLE KEYS */;
INSERT INTO `_migrations` VALUES (3,'004_fix_transaction_enums','2026-06-25 15:33:36'),(5,'001_create_escrow_tables','2026-06-25 15:39:43'),(6,'002_add_buyer_id_to_listings','2026-06-25 15:39:44'),(7,'005_create_seller_bank_accounts','2026-06-25 15:39:44'),(8,'003_add_read_column_to_notifications','2026-06-25 16:16:20'),(9,'006_add_audit_tracking_columns','2026-06-25 16:26:46');
/*!40000 ALTER TABLE `_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary table structure for view `active_suspensions`
--

DROP TABLE IF EXISTS `active_suspensions`;
/*!50001 DROP VIEW IF EXISTS `active_suspensions`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `active_suspensions` AS SELECT
 1 AS `id`,
  1 AS `user_id`,
  1 AS `suspended_by`,
  1 AS `reason`,
  1 AS `expires_at`,
  1 AS `is_active`,
  1 AS `created_at`,
  1 AS `updated_at`,
  1 AS `user_name`,
  1 AS `user_email`,
  1 AS `suspended_by_name` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `admin_activity_log`
--

DROP TABLE IF EXISTS `admin_activity_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `admin_activity_log` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `admin_id` varchar(36) NOT NULL,
  `action` varchar(100) NOT NULL,
  `target_type` varchar(50) DEFAULT NULL COMMENT 'user, device, report, system',
  `target_id` varchar(36) DEFAULT NULL COMMENT 'ID of the target entity',
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Additional action details' CHECK (json_valid(`details`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_admin_id` (`admin_id`),
  KEY `idx_action` (`action`),
  KEY `idx_target_type` (`target_type`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `admin_activity_log_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Admin-specific activity logging';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `admin_activity_log`
--

LOCK TABLES `admin_activity_log` WRITE;
/*!40000 ALTER TABLE `admin_activity_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `admin_activity_log` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary table structure for view `admin_dashboard_summary`
--

DROP TABLE IF EXISTS `admin_dashboard_summary`;
/*!50001 DROP VIEW IF EXISTS `admin_dashboard_summary`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `admin_dashboard_summary` AS SELECT
 1 AS `total_users`,
  1 AS `admin_users`,
  1 AS `lea_users`,
  1 AS `total_devices`,
  1 AS `pending_verifications`,
  1 AS `verified_devices`,
  1 AS `stolen_lost_devices`,
  1 AS `total_reports`,
  1 AS `open_reports`,
  1 AS `resolved_reports`,
  1 AS `pending_notifications`,
  1 AS `failed_notifications`,
  1 AS `active_suspensions`,
  1 AS `unresolved_alerts` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `api_keys`
--

DROP TABLE IF EXISTS `api_keys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `api_keys` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `key_prefix` varchar(20) NOT NULL,
  `key_hash` varchar(64) NOT NULL,
  `permissions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`permissions`)),
  `last_used_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT (current_timestamp() + interval 90 day),
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_key_prefix` (`key_prefix`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `api_keys_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `api_keys`
--

LOCK TABLES `api_keys` WRITE;
/*!40000 ALTER TABLE `api_keys` DISABLE KEYS */;
/*!40000 ALTER TABLE `api_keys` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `audit_logs` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `user_id` varchar(36) DEFAULT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `action` varchar(100) NOT NULL COMMENT 'Action performed',
  `table_name` varchar(50) DEFAULT NULL COMMENT 'Table affected',
  `record_id` varchar(36) DEFAULT NULL COMMENT 'Record ID affected',
  `old_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Previous values' CHECK (json_valid(`old_values`)),
  `new_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'New values' CHECK (json_valid(`new_values`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `mac_address` varchar(255) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `session_id` varchar(255) DEFAULT NULL,
  `request_method` varchar(10) DEFAULT NULL,
  `request_url` text DEFAULT NULL,
  `response_status` int(11) DEFAULT NULL,
  `execution_time_ms` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `resource_type` enum('user','device','report','auth','system','api') DEFAULT 'system',
  `resource_id` varchar(36) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `severity` enum('low','medium','high','critical') DEFAULT 'low',
  `status` enum('success','failed','warning') DEFAULT 'success',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_table_name` (`table_name`),
  KEY `idx_record_id` (`record_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_audit_resource_type` (`resource_type`),
  KEY `idx_audit_severity` (`severity`),
  KEY `idx_audit_status` (`status`),
  KEY `idx_audit_composite` (`user_id`,`created_at`,`action`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='System audit trail';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `data_exports`
--

DROP TABLE IF EXISTS `data_exports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `data_exports` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `export_type` enum('full','profile','devices','reports','activity') NOT NULL,
  `status` enum('pending','processing','completed','failed','expired') DEFAULT 'pending',
  `file_path` varchar(255) DEFAULT NULL,
  `file_size` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NOT NULL DEFAULT (current_timestamp() + interval 7 day),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `data_exports_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `data_exports`
--

LOCK TABLES `data_exports` WRITE;
/*!40000 ALTER TABLE `data_exports` DISABLE KEYS */;
/*!40000 ALTER TABLE `data_exports` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `delivery_confirmations`
--

DROP TABLE IF EXISTS `delivery_confirmations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `delivery_confirmations` (
  `id` varchar(36) NOT NULL,
  `escrow_id` varchar(36) NOT NULL,
  `listing_id` varchar(36) NOT NULL,
  `buyer_id` varchar(36) NOT NULL,
  `seller_id` varchar(36) NOT NULL,
  `status` enum('pending','confirmed','disputed') NOT NULL DEFAULT 'pending',
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `disputed_at` timestamp NULL DEFAULT NULL,
  `dispute_reason` text DEFAULT NULL,
  `admin_notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `delconf_fk_escrow` (`escrow_id`),
  KEY `delconf_fk_list` (`listing_id`),
  KEY `delconf_fk_buyer` (`buyer_id`),
  KEY `delconf_fk_seller` (`seller_id`),
  CONSTRAINT `delconf_fk_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delconf_fk_escrow` FOREIGN KEY (`escrow_id`) REFERENCES `escrow_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delconf_fk_list` FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delconf_fk_seller` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delivery_confirmations_ibfk_1` FOREIGN KEY (`escrow_id`) REFERENCES `escrow_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delivery_confirmations_ibfk_2` FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delivery_confirmations_ibfk_3` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `delivery_confirmations_ibfk_4` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `delivery_confirmations`
--

LOCK TABLES `delivery_confirmations` WRITE;
/*!40000 ALTER TABLE `delivery_confirmations` DISABLE KEYS */;
/*!40000 ALTER TABLE `delivery_confirmations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_access_logs`
--

DROP TABLE IF EXISTS `device_access_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_access_logs` (
  `id` varchar(36) NOT NULL,
  `device_id` varchar(36) NOT NULL,
  `user_id` varchar(255) DEFAULT NULL,
  `access_type` varchar(64) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `ip_address` varchar(64) DEFAULT NULL,
  `mac_address` varchar(255) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `session_id` varchar(255) DEFAULT NULL,
  `result` varchar(16) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `location_latitude` double DEFAULT NULL,
  `location_longitude` double DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_access_logs`
--

LOCK TABLES `device_access_logs` WRITE;
/*!40000 ALTER TABLE `device_access_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_access_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_brands`
--

DROP TABLE IF EXISTS `device_brands`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_brands` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `category_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_brands`
--

LOCK TABLES `device_brands` WRITE;
/*!40000 ALTER TABLE `device_brands` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_brands` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_categories`
--

DROP TABLE IF EXISTS `device_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category_key` varchar(50) NOT NULL,
  `label` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `required_fields` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`required_fields`)),
  `optional_fields` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`optional_fields`)),
  `identifier_type` enum('imei','serial','vin','generic') DEFAULT 'generic',
  `active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `category_key` (`category_key`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_categories`
--

LOCK TABLES `device_categories` WRITE;
/*!40000 ALTER TABLE `device_categories` DISABLE KEYS */;
INSERT INTO `device_categories` VALUES (1,'mobile_phone','Phone','Mobile phones with IMEI identifiers','[\"imei\", \"brand\", \"model\"]','[\"imei2\", \"networkCarrier\", \"operatingSystem\", \"storageCapacity\", \"color\"]','imei',1,'2025-11-02 16:13:52','2025-11-02 16:13:52'),(2,'vehicle','Vehicle','Vehicles identified by VIN and plate','[\"vin\", \"licensePlate\", \"year\", \"brand\", \"model\"]','[\"engineNumber\", \"registrationState\", \"color\"]','vin',1,'2025-11-02 16:13:52','2025-11-02 16:13:52'),(3,'computer','Computers','Computers identified by serial number','[\"serialNumber\", \"brand\", \"model\"]','[\"macAddress\", \"processorType\", \"operatingSystem\", \"ramSize\", \"color\"]','serial',1,'2025-11-02 16:13:52','2025-11-02 16:13:52'),(4,'smart_watch','Smart Watch','Smart watches identified by serial number or IMEI for LTE models','[\"serialNumber\", \"brand\", \"model\"]','[\"imei\", \"bluetoothMac\", \"operatingSystem\", \"color\"]','serial',1,'2025-11-02 16:13:52','2025-11-02 16:13:52'),(5,'others','Others','Other devices with flexible identifiers','[\"description\", \"brand\", \"model\"]','[\"serialNumber\", \"modelNumber\", \"estimatedValue\", \"color\"]','generic',1,'2025-11-02 16:13:52','2025-11-02 16:13:52');
/*!40000 ALTER TABLE `device_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_check_logs`
--

DROP TABLE IF EXISTS `device_check_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_check_logs` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_id` varchar(36) NOT NULL,
  `checker_user_id` varchar(36) DEFAULT NULL,
  `check_type` enum('public_check','ownership_verification','purchase_check') NOT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `location_accuracy` float DEFAULT NULL,
  `location_source` enum('gps','network','passive') DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `mac_address` varchar(17) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `browser_fingerprint` text DEFAULT NULL,
  `device_fingerprint` text DEFAULT NULL,
  `session_id` varchar(255) DEFAULT NULL,
  `risk_score` int(11) DEFAULT 0,
  `suspicious_flags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`suspicious_flags`)),
  `check_result` enum('legitimate','stolen','suspicious','unknown') DEFAULT NULL,
  `warnings_shown` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`warnings_shown`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `checker_user_id` (`checker_user_id`),
  KEY `idx_device_checks` (`device_id`,`created_at`),
  KEY `idx_location` (`latitude`,`longitude`),
  KEY `idx_ip_address` (`ip_address`),
  KEY `idx_mac_address` (`mac_address`),
  CONSTRAINT `device_check_logs_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `device_check_logs_ibfk_2` FOREIGN KEY (`checker_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_check_logs`
--

LOCK TABLES `device_check_logs` WRITE;
/*!40000 ALTER TABLE `device_check_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_check_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_checks`
--

DROP TABLE IF EXISTS `device_checks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_checks` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_id` varchar(36) DEFAULT NULL COMMENT 'Device being checked (NULL for non-existent devices)',
  `query` varchar(100) NOT NULL COMMENT 'IMEI/Serial/MAC searched',
  `checker_user_id` varchar(36) DEFAULT NULL COMMENT 'Registered user who performed check',
  `checker_name` varchar(255) DEFAULT NULL COMMENT 'Name provided by anonymous checker',
  `checker_email` varchar(255) DEFAULT NULL COMMENT 'Email provided by anonymous checker',
  `checker_phone` varchar(20) DEFAULT NULL COMMENT 'Phone provided by anonymous checker',
  `ip_address` varchar(45) NOT NULL,
  `mac_address` varchar(17) DEFAULT NULL COMMENT 'Device MAC address',
  `user_agent` text DEFAULT NULL,
  `location_latitude` decimal(10,8) DEFAULT NULL COMMENT 'GPS latitude',
  `location_longitude` decimal(11,8) DEFAULT NULL COMMENT 'GPS longitude',
  `location_accuracy` decimal(8,2) DEFAULT NULL COMMENT 'Location accuracy in meters',
  `location_address` text DEFAULT NULL COMMENT 'Reverse geocoded address',
  `device_fingerprint` text DEFAULT NULL COMMENT 'Browser/device fingerprint',
  `check_result` enum('found','not_found','reported_stolen','reported_lost','reported_missing') NOT NULL,
  `device_status_at_check` enum('verified','unverified','stolen','lost','found','pending_transfer') DEFAULT NULL,
  `is_suspicious` tinyint(1) DEFAULT 0 COMMENT 'Flagged as suspicious check',
  `alert_sent` tinyint(1) DEFAULT 0 COMMENT 'Whether alerts were sent for this check',
  `notes` text DEFAULT NULL COMMENT 'Additional notes about the check',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_device_checks_device_id` (`device_id`),
  KEY `idx_device_checks_checker_user_id` (`checker_user_id`),
  KEY `idx_device_checks_query` (`query`),
  KEY `idx_device_checks_ip_address` (`ip_address`),
  KEY `idx_device_checks_mac_address` (`mac_address`),
  KEY `idx_device_checks_location` (`location_latitude`,`location_longitude`),
  KEY `idx_device_checks_check_result` (`check_result`),
  KEY `idx_device_checks_is_suspicious` (`is_suspicious`),
  KEY `idx_device_checks_created_at` (`created_at`),
  CONSTRAINT `device_checks_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `device_checks_ibfk_2` FOREIGN KEY (`checker_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Comprehensive device check tracking with location and user data';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_checks`
--

LOCK TABLES `device_checks` WRITE;
/*!40000 ALTER TABLE `device_checks` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_checks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_models`
--

DROP TABLE IF EXISTS `device_models`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_models` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `brand_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_models`
--

LOCK TABLES `device_models` WRITE;
/*!40000 ALTER TABLE `device_models` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_models` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary table structure for view `device_summary`
--

DROP TABLE IF EXISTS `device_summary`;
/*!50001 DROP VIEW IF EXISTS `device_summary`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `device_summary` AS SELECT
 1 AS `id`,
  1 AS `brand`,
  1 AS `model`,
  1 AS `imei`,
  1 AS `serial`,
  1 AS `status`,
  1 AS `owner_name`,
  1 AS `owner_email`,
  1 AS `created_at`,
  1 AS `verified_at`,
  1 AS `active_reports` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `device_transfers`
--

DROP TABLE IF EXISTS `device_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_transfers` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_id` varchar(36) NOT NULL,
  `from_user_id` varchar(36) NOT NULL,
  `to_user_id` varchar(36) NOT NULL,
  `transfer_code` varchar(10) NOT NULL COMMENT 'OTP for verification',
  `status` enum('pending','accepted','rejected','expired') DEFAULT 'pending',
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `accepted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_from_user` (`from_user_id`),
  KEY `idx_to_user` (`to_user_id`),
  KEY `idx_transfer_code` (`transfer_code`),
  KEY `idx_status` (`status`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `device_transfers_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `device_transfers_ibfk_2` FOREIGN KEY (`from_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `device_transfers_ibfk_3` FOREIGN KEY (`to_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Device ownership transfer requests';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_transfers`
--

LOCK TABLES `device_transfers` WRITE;
/*!40000 ALTER TABLE `device_transfers` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_transfers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_verification_history`
--

DROP TABLE IF EXISTS `device_verification_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_verification_history` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_id` varchar(36) NOT NULL,
  `verified_by` varchar(36) NOT NULL,
  `action` enum('approved','rejected','pending_review') NOT NULL,
  `notes` text DEFAULT NULL,
  `proof_documents` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Array of document URLs reviewed' CHECK (json_valid(`proof_documents`)),
  `verification_score` int(11) DEFAULT NULL COMMENT '1-10 confidence score',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_verified_by` (`verified_by`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `device_verification_history_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `device_verification_history_ibfk_2` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Device verification audit trail';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_verification_history`
--

LOCK TABLES `device_verification_history` WRITE;
/*!40000 ALTER TABLE `device_verification_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_verification_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `device_verifications`
--

DROP TABLE IF EXISTS `device_verifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `device_verifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `device_id` varchar(36) NOT NULL,
  `verified_by` varchar(36) DEFAULT NULL,
  `action` varchar(50) NOT NULL DEFAULT 'verified',
  `status` varchar(50) NOT NULL DEFAULT 'approved',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_device_verifications_device_id` (`device_id`),
  KEY `idx_verified_by` (`verified_by`),
  CONSTRAINT `device_verifications_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `device_verifications_ibfk_2` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Device verification history with actor and status';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_verifications`
--

LOCK TABLES `device_verifications` WRITE;
/*!40000 ALTER TABLE `device_verifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `device_verifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `devices`
--

DROP TABLE IF EXISTS `devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `devices` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `user_id` varchar(36) NOT NULL,
  `imei` varchar(15) DEFAULT NULL COMMENT 'International Mobile Equipment Identity',
  `serial` varchar(100) DEFAULT NULL COMMENT 'Device serial number',
  `brand` varchar(100) NOT NULL,
  `model` varchar(100) NOT NULL,
  `color` varchar(50) DEFAULT NULL,
  `device_image_url` text DEFAULT NULL,
  `proof_url` text DEFAULT NULL COMMENT 'Receipt/invoice URL',
  `status` enum('verified','unverified','stolen','lost','found','pending_transfer') DEFAULT 'unverified',
  `verified_by` varchar(36) DEFAULT NULL COMMENT 'Admin who verified',
  `verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `verification_notes` text DEFAULT NULL,
  `last_checked_at` timestamp NULL DEFAULT NULL,
  `check_count` int(11) DEFAULT 0,
  `is_public` tinyint(1) DEFAULT 1,
  `recovery_instructions` text DEFAULT NULL,
  `category` enum('mobile_phone','computer','vehicle','electronics','jewelry','others') NOT NULL DEFAULT 'others',
  `last_check_date` timestamp NULL DEFAULT NULL,
  `risk_level` enum('low','medium','high') DEFAULT 'low',
  `imei2` varchar(15) DEFAULT NULL,
  `network_carrier` varchar(100) DEFAULT NULL,
  `operating_system` varchar(100) DEFAULT NULL,
  `storage_capacity` varchar(50) DEFAULT NULL,
  `mac_address` varchar(17) DEFAULT NULL,
  `processor_type` varchar(100) DEFAULT NULL,
  `ram_size` varchar(50) DEFAULT NULL,
  `bluetooth_mac` varchar(17) DEFAULT NULL,
  `vin` varchar(17) DEFAULT NULL,
  `license_plate` varchar(20) DEFAULT NULL,
  `year` varchar(4) DEFAULT NULL,
  `engine_number` varchar(50) DEFAULT NULL,
  `registration_state` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `estimated_value` decimal(12,2) DEFAULT NULL,
  `certificate_number` varchar(100) DEFAULT NULL,
  `device_image_blob` longblob DEFAULT NULL,
  `device_image_mime` varchar(100) DEFAULT NULL,
  `device_image_filename` varchar(255) DEFAULT NULL,
  `proof_blob` longblob DEFAULT NULL,
  `proof_mime` varchar(100) DEFAULT NULL,
  `proof_filename` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `imei` (`imei`),
  UNIQUE KEY `serial` (`serial`),
  KEY `verified_by` (`verified_by`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_imei` (`imei`),
  KEY `idx_serial` (`serial`),
  KEY `idx_status` (`status`),
  KEY `idx_brand_model` (`brand`,`model`),
  KEY `idx_devices_status_created` (`status`,`created_at`),
  KEY `idx_devices_status` (`status`),
  KEY `idx_devices_brand` (`brand`),
  KEY `idx_devices_created_at` (`created_at`),
  KEY `idx_devices_imei` (`imei`),
  KEY `idx_devices_serial` (`serial`),
  KEY `idx_category` (`category`),
  KEY `idx_vin` (`vin`),
  KEY `idx_license_plate` (`license_plate`),
  KEY `idx_mac_address` (`mac_address`),
  KEY `idx_bluetooth_mac` (`bluetooth_mac`),
  CONSTRAINT `devices_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `devices_ibfk_2` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_imei_or_serial` CHECK (`imei` is not null or `serial` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Registered devices with IMEI/serial and proof';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `devices`
--

LOCK TABLES `devices` WRITE;
/*!40000 ALTER TABLE `devices` DISABLE KEYS */;
/*!40000 ALTER TABLE `devices` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = cp850 */ ;
/*!50003 SET character_set_results = cp850 */ ;
/*!50003 SET collation_connection  = cp850_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER devices_audit_insert 
AFTER INSERT ON devices 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, ip_address)
    VALUES (NEW.user_id, 'INSERT', 'devices', NEW.id, JSON_OBJECT(
        'brand', NEW.brand,
        'model', NEW.model,
        'imei', NEW.imei,
        'serial', NEW.serial,
        'status', NEW.status
    ), @client_ip);
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = cp850 */ ;
/*!50003 SET character_set_results = cp850 */ ;
/*!50003 SET collation_connection  = cp850_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER devices_audit_update 
AFTER UPDATE ON devices 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address)
    VALUES (NEW.user_id, 'UPDATE', 'devices', NEW.id, 
        JSON_OBJECT('status', OLD.status, 'verified_at', OLD.verified_at),
        JSON_OBJECT('status', NEW.status, 'verified_at', NEW.verified_at),
        @client_ip);
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `email_verification_tokens`
--

DROP TABLE IF EXISTS `email_verification_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `email_verification_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(255) NOT NULL,
  `token` varchar(128) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_token` (`token`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `email_verification_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_verification_tokens`
--

LOCK TABLES `email_verification_tokens` WRITE;
/*!40000 ALTER TABLE `email_verification_tokens` DISABLE KEYS */;
/*!40000 ALTER TABLE `email_verification_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `escrow_transactions`
--

DROP TABLE IF EXISTS `escrow_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `escrow_transactions` (
  `id` varchar(36) NOT NULL,
  `transaction_id` varchar(36) NOT NULL,
  `listing_id` varchar(36) NOT NULL,
  `buyer_id` varchar(36) NOT NULL,
  `seller_id` varchar(36) NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `platform_fee_percent` decimal(5,2) NOT NULL DEFAULT 2.50,
  `platform_fee_amount` decimal(15,2) NOT NULL DEFAULT 0.00,
  `seller_amount` decimal(15,2) NOT NULL DEFAULT 0.00,
  `status` enum('held','released','refunded','disputed') NOT NULL DEFAULT 'held',
  `released_at` timestamp NULL DEFAULT NULL,
  `refunded_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `escrow_fk_txn` (`transaction_id`),
  KEY `escrow_fk_list` (`listing_id`),
  KEY `escrow_fk_buyer` (`buyer_id`),
  KEY `escrow_fk_seller` (`seller_id`),
  CONSTRAINT `escrow_fk_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `escrow_fk_list` FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `escrow_fk_seller` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `escrow_fk_txn` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `escrow_transactions_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `escrow_transactions_ibfk_2` FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `escrow_transactions_ibfk_3` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `escrow_transactions_ibfk_4` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `escrow_transactions`
--

LOCK TABLES `escrow_transactions` WRITE;
/*!40000 ALTER TABLE `escrow_transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `escrow_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `imei_checks`
--

DROP TABLE IF EXISTS `imei_checks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `imei_checks` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `query` varchar(100) NOT NULL COMMENT 'IMEI or serial searched',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Check result data' CHECK (json_valid(`result`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_query` (`query`),
  KEY `idx_ip_address` (`ip_address`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Public device check logs for analytics';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `imei_checks`
--

LOCK TABLES `imei_checks` WRITE;
/*!40000 ALTER TABLE `imei_checks` DISABLE KEYS */;
/*!40000 ALTER TABLE `imei_checks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kyc_batches`
--

DROP TABLE IF EXISTS `kyc_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `kyc_batches` (
  `id` char(36) NOT NULL,
  `batch_status` enum('pending','processing','completed','failed') DEFAULT 'pending',
  `total_records` int(11) DEFAULT 0,
  `successful_verifications` int(11) DEFAULT 0,
  `failed_verifications` int(11) DEFAULT 0,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kyc_batches`
--

LOCK TABLES `kyc_batches` WRITE;
/*!40000 ALTER TABLE `kyc_batches` DISABLE KEYS */;
/*!40000 ALTER TABLE `kyc_batches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kyc_verifications`
--

DROP TABLE IF EXISTS `kyc_verifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `kyc_verifications` (
  `id` char(36) NOT NULL,
  `user_id` varchar(255) NOT NULL,
  `nin` text NOT NULL,
  `nin_status` enum('pending','verified','failed') DEFAULT 'pending',
  `face_match_score` float DEFAULT NULL,
  `liveness_passed` tinyint(1) DEFAULT NULL,
  `verification_batch_id` char(36) DEFAULT NULL,
  `verification_response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`verification_response`)),
  `verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `verification_batch_id` (`verification_batch_id`),
  CONSTRAINT `kyc_verifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `kyc_verifications_ibfk_2` FOREIGN KEY (`verification_batch_id`) REFERENCES `kyc_batches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kyc_verifications`
--

LOCK TABLES `kyc_verifications` WRITE;
/*!40000 ALTER TABLE `kyc_verifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `kyc_verifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `landing_content`
--

DROP TABLE IF EXISTS `landing_content`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `landing_content` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('team','testimonial') NOT NULL,
  `name` varchar(255) NOT NULL,
  `role` varchar(255) NOT NULL,
  `image_url` text DEFAULT NULL,
  `content` text DEFAULT NULL,
  `display_order` int(11) DEFAULT 0,
  `active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `landing_content`
--

LOCK TABLES `landing_content` WRITE;
/*!40000 ALTER TABLE `landing_content` DISABLE KEYS */;
/*!40000 ALTER TABLE `landing_content` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `law_enforcement_agencies`
--

DROP TABLE IF EXISTS `law_enforcement_agencies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `law_enforcement_agencies` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `agency_name` varchar(255) NOT NULL,
  `contact_email` varchar(255) NOT NULL DEFAULT 'clintonfaze@gmail.com',
  `contact_phone` varchar(20) DEFAULT NULL,
  `region` varchar(100) NOT NULL,
  `address` text DEFAULT NULL,
  `jurisdiction_type` enum('local','state','federal') DEFAULT 'local',
  `active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_region` (`region`),
  KEY `idx_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Law enforcement agencies by region';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `law_enforcement_agencies`
--

LOCK TABLES `law_enforcement_agencies` WRITE;
/*!40000 ALTER TABLE `law_enforcement_agencies` DISABLE KEYS */;
/*!40000 ALTER TABLE `law_enforcement_agencies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `marketplace_listings`
--

DROP TABLE IF EXISTS `marketplace_listings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `marketplace_listings` (
  `id` varchar(36) NOT NULL,
  `seller_id` varchar(36) NOT NULL,
  `device_id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(15,2) NOT NULL,
  `currency` varchar(3) DEFAULT 'NGN',
  `device_condition` enum('new','used','refurbished') NOT NULL,
  `status` enum('active','sold','hidden','deleted') DEFAULT 'active',
  `location` varchar(255) DEFAULT NULL,
  `images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`images`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `featured` tinyint(1) DEFAULT 0,
  `buyer_id` varchar(36) DEFAULT NULL,
  `sold_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_listings_seller` (`seller_id`),
  KEY `idx_listings_device` (`device_id`),
  KEY `idx_listings_status` (`status`),
  KEY `idx_listings_price` (`price`),
  CONSTRAINT `marketplace_listings_ibfk_1` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `marketplace_listings_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `marketplace_listings`
--

LOCK TABLES `marketplace_listings` WRITE;
/*!40000 ALTER TABLE `marketplace_listings` DISABLE KEYS */;
/*!40000 ALTER TABLE `marketplace_listings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `marketplace_messages`
--

DROP TABLE IF EXISTS `marketplace_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `marketplace_messages` (
  `id` varchar(36) NOT NULL,
  `listing_id` varchar(36) NOT NULL,
  `sender_id` varchar(36) NOT NULL,
  `receiver_id` varchar(36) NOT NULL,
  `content` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `read_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `marketplace_messages`
--

LOCK TABLES `marketplace_messages` WRITE;
/*!40000 ALTER TABLE `marketplace_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `marketplace_messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `migrations`
--

DROP TABLE IF EXISTS `migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `executed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `checksum` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`),
  KEY `idx_filename` (`filename`),
  KEY `idx_executed_at` (`executed_at`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `migrations`
--

LOCK TABLES `migrations` WRITE;
/*!40000 ALTER TABLE `migrations` DISABLE KEYS */;
/*!40000 ALTER TABLE `migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_queue`
--

DROP TABLE IF EXISTS `notification_queue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_queue` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `notification_type` enum('email','sms','push') NOT NULL,
  `subject` varchar(200) DEFAULT NULL,
  `message` text NOT NULL,
  `html_content` text DEFAULT NULL,
  `recipient` varchar(255) NOT NULL,
  `status` enum('pending','sent','failed','cancelled') DEFAULT 'pending',
  `attempts` int(11) DEFAULT 0,
  `max_attempts` int(11) DEFAULT 3,
  `scheduled_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sent_at` timestamp NULL DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_notification_type` (`notification_type`),
  KEY `idx_scheduled_at` (`scheduled_at`),
  CONSTRAINT `notification_queue_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_queue`
--

LOCK TABLES `notification_queue` WRITE;
/*!40000 ALTER TABLE `notification_queue` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_queue` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_settings`
--

DROP TABLE IF EXISTS `notification_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_settings` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `user_id` varchar(36) NOT NULL,
  `email_enabled` tinyint(1) DEFAULT 1,
  `email_device_checks` tinyint(1) DEFAULT 1 COMMENT 'Notify when device is checked',
  `email_device_reports` tinyint(1) DEFAULT 1 COMMENT 'Notify when device is reported',
  `email_device_transfers` tinyint(1) DEFAULT 1 COMMENT 'Notify about transfer requests',
  `email_device_verification` tinyint(1) DEFAULT 1 COMMENT 'Notify about verification status',
  `email_suspicious_activity` tinyint(1) DEFAULT 1 COMMENT 'Notify about suspicious checks',
  `email_lea_updates` tinyint(1) DEFAULT 1 COMMENT 'Notify about LEA case updates',
  `email_marketing` tinyint(1) DEFAULT 0,
  `sms_enabled` tinyint(1) DEFAULT 0,
  `sms_device_checks` tinyint(1) DEFAULT 0,
  `sms_device_reports` tinyint(1) DEFAULT 1 COMMENT 'SMS for critical reports',
  `sms_suspicious_activity` tinyint(1) DEFAULT 1 COMMENT 'SMS for suspicious activity',
  `sms_emergency_alerts` tinyint(1) DEFAULT 1 COMMENT 'SMS for emergency alerts',
  `push_enabled` tinyint(1) DEFAULT 1,
  `push_device_checks` tinyint(1) DEFAULT 1,
  `push_device_reports` tinyint(1) DEFAULT 1,
  `push_device_transfers` tinyint(1) DEFAULT 1,
  `push_suspicious_activity` tinyint(1) DEFAULT 1,
  `digest_frequency` enum('immediate','hourly','daily','weekly','never') DEFAULT 'immediate',
  `quiet_hours_start` time DEFAULT NULL COMMENT 'Start of quiet hours (no notifications)',
  `quiet_hours_end` time DEFAULT NULL COMMENT 'End of quiet hours',
  `timezone` varchar(50) DEFAULT 'UTC',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_notification_settings` (`user_id`),
  CONSTRAINT `notification_settings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Comprehensive notification preferences for users';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_settings`
--

LOCK TABLES `notification_settings` WRITE;
/*!40000 ALTER TABLE `notification_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notifications` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `user_id` varchar(36) DEFAULT NULL,
  `channel` enum('email','sms','push') NOT NULL,
  `recipient` varchar(255) NOT NULL COMMENT 'Email/phone/device_token',
  `subject` varchar(255) DEFAULT NULL,
  `message` text NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Additional data for notification' CHECK (json_valid(`payload`)),
  `status` enum('pending','sent','failed','delivered') DEFAULT 'pending',
  `is_read` tinyint(1) DEFAULT 0,
  `read_at` timestamp NULL DEFAULT NULL,
  `sent_at` timestamp NULL DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `retry_count` int(11) DEFAULT 0 COMMENT 'Number of retry attempts',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_channel` (`channel`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_notifications_status_created` (`status`,`created_at`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Email/SMS/push notification queue';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `otps`
--

DROP TABLE IF EXISTS `otps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `otps` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `user_id` varchar(36) NOT NULL,
  `otp_code` varchar(10) NOT NULL,
  `otp_type` varchar(50) NOT NULL,
  `reference_id` varchar(128) DEFAULT NULL COMMENT 'Reference to related record (transfer_id, device_fingerprint, etc.)',
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `used_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) DEFAULT 0,
  `max_attempts` int(11) DEFAULT 3,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_otp_code` (`otp_code`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_otp_type` (`otp_type`),
  CONSTRAINT `otps_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='One-time passwords for secure operations';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `otps`
--

LOCK TABLES `otps` WRITE;
/*!40000 ALTER TABLE `otps` DISABLE KEYS */;
/*!40000 ALTER TABLE `otps` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ownership_transfers`
--

DROP TABLE IF EXISTS `ownership_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ownership_transfers` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_id` varchar(36) NOT NULL,
  `from_user_id` varchar(36) NOT NULL,
  `to_user_id` varchar(36) DEFAULT NULL,
  `transfer_code` varchar(20) NOT NULL,
  `otp_code` varchar(6) DEFAULT NULL,
  `status` enum('initiated','otp_verified','active','completed','expired','cancelled') DEFAULT 'initiated',
  `sale_price` decimal(10,2) DEFAULT NULL,
  `transfer_reason` text DEFAULT NULL,
  `buyer_email` varchar(255) DEFAULT NULL,
  `agreement_terms` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`agreement_terms`)),
  `transfer_location` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`transfer_location`)),
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `otp_expires_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `transfer_code` (`transfer_code`),
  KEY `from_user_id` (`from_user_id`),
  KEY `to_user_id` (`to_user_id`),
  KEY `idx_transfer_code` (`transfer_code`),
  KEY `idx_device_transfers` (`device_id`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `ownership_transfers_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ownership_transfers_ibfk_2` FOREIGN KEY (`from_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ownership_transfers_ibfk_3` FOREIGN KEY (`to_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ownership_transfers`
--

LOCK TABLES `ownership_transfers` WRITE;
/*!40000 ALTER TABLE `ownership_transfers` DISABLE KEYS */;
/*!40000 ALTER TABLE `ownership_transfers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `password_resets`
--

DROP TABLE IF EXISTS `password_resets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `password_resets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(255) NOT NULL,
  `token` varchar(128) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `user_id` (`user_id`),
  KEY `idx_token` (`token`),
  CONSTRAINT `password_resets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `password_resets`
--

LOCK TABLES `password_resets` WRITE;
/*!40000 ALTER TABLE `password_resets` DISABLE KEYS */;
/*!40000 ALTER TABLE `password_resets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payment_methods`
--

DROP TABLE IF EXISTS `payment_methods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payment_methods` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `type` enum('card','bank_account') NOT NULL,
  `provider` varchar(50) DEFAULT 'manual',
  `last4` varchar(4) DEFAULT NULL,
  `exp_month` int(11) DEFAULT NULL,
  `exp_year` int(11) DEFAULT NULL,
  `is_default` tinyint(1) DEFAULT 0,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_payment_user` (`user_id`),
  CONSTRAINT `payment_methods_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payment_methods`
--

LOCK TABLES `payment_methods` WRITE;
/*!40000 ALTER TABLE `payment_methods` DISABLE KEYS */;
/*!40000 ALTER TABLE `payment_methods` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `push_subscriptions`
--

DROP TABLE IF EXISTS `push_subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `push_subscriptions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `endpoint` text NOT NULL,
  `p256dh_key` text NOT NULL,
  `auth_key` text NOT NULL,
  `user_agent` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `push_subscriptions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `push_subscriptions`
--

LOCK TABLES `push_subscriptions` WRITE;
/*!40000 ALTER TABLE `push_subscriptions` DISABLE KEYS */;
/*!40000 ALTER TABLE `push_subscriptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recovery_agents`
--

DROP TABLE IF EXISTS `recovery_agents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `recovery_agents` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `specialization` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`specialization`)),
  `region` varchar(100) DEFAULT NULL,
  `active_cases` int(11) DEFAULT 0,
  `max_cases` int(11) DEFAULT 10,
  `success_rate` decimal(5,2) DEFAULT 0.00,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recovery_agents`
--

LOCK TABLES `recovery_agents` WRITE;
/*!40000 ALTER TABLE `recovery_agents` DISABLE KEYS */;
/*!40000 ALTER TABLE `recovery_agents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recovery_services`
--

DROP TABLE IF EXISTS `recovery_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `recovery_services` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `service_package` enum('basic','standard','premium') NOT NULL,
  `payment_intent_id` varchar(255) DEFAULT NULL,
  `payment_status` enum('pending','paid','failed','refunded') DEFAULT 'pending',
  `amount_paid` decimal(10,2) DEFAULT NULL,
  `currency` varchar(3) DEFAULT 'USD',
  `assigned_agent_id` varchar(36) DEFAULT NULL,
  `status` enum('payment_pending','active','investigating','leads_found','recovered','unsuccessful','refunded') DEFAULT 'payment_pending',
  `service_notes` text DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `activated_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_device_recovery` (`device_id`),
  KEY `idx_user_recovery` (`user_id`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_service_status` (`status`),
  KEY `assigned_agent_id` (`assigned_agent_id`),
  CONSTRAINT `recovery_services_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `recovery_services_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `recovery_services_ibfk_3` FOREIGN KEY (`assigned_agent_id`) REFERENCES `recovery_agents` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recovery_services`
--

LOCK TABLES `recovery_services` WRITE;
/*!40000 ALTER TABLE `recovery_services` DISABLE KEYS */;
/*!40000 ALTER TABLE `recovery_services` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary table structure for view `report_summary`
--

DROP TABLE IF EXISTS `report_summary`;
/*!50001 DROP VIEW IF EXISTS `report_summary`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `report_summary` AS SELECT
 1 AS `id`,
  1 AS `case_id`,
  1 AS `report_type`,
  1 AS `status`,
  1 AS `occurred_at`,
  1 AS `location`,
  1 AS `brand`,
  1 AS `model`,
  1 AS `imei`,
  1 AS `serial`,
  1 AS `reporter_name`,
  1 AS `reporter_email`,
  1 AS `agency_name`,
  1 AS `lea_email`,
  1 AS `created_at` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `reports`
--

DROP TABLE IF EXISTS `reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `reports` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_id` varchar(36) NOT NULL,
  `report_type` enum('stolen','lost','found') NOT NULL,
  `reporter_id` varchar(36) DEFAULT NULL COMMENT 'User who filed report, NULL for anonymous',
  `description` text NOT NULL,
  `occurred_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT 'When incident occurred',
  `location` varchar(255) DEFAULT NULL,
  `evidence_url` text DEFAULT NULL,
  `status` enum('open','under_review','resolved','dismissed') DEFAULT 'open',
  `case_id` varchar(20) NOT NULL COMMENT 'System-generated case ID',
  `assigned_lea_id` varchar(36) DEFAULT NULL,
  `lea_notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `police_report_number` varchar(100) DEFAULT NULL,
  `circumstances` text DEFAULT NULL,
  `witness_info` text DEFAULT NULL,
  `recovery_instructions` text DEFAULT NULL,
  `assigned_to` varchar(36) DEFAULT NULL,
  `priority` enum('low','medium','high','urgent') DEFAULT 'medium',
  `resolution_notes` text DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolved_by` varchar(36) DEFAULT NULL,
  `evidence_url_additional` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `case_id` (`case_id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_reporter_id` (`reporter_id`),
  KEY `idx_case_id` (`case_id`),
  KEY `idx_status` (`status`),
  KEY `idx_report_type` (`report_type`),
  KEY `idx_assigned_lea` (`assigned_lea_id`),
  KEY `idx_occurred_at` (`occurred_at`),
  KEY `idx_reports_status_created` (`status`,`created_at`),
  KEY `idx_reports_status` (`status`),
  KEY `idx_reports_type` (`report_type`),
  KEY `idx_reports_created_at` (`created_at`),
  KEY `idx_reports_case_id` (`case_id`),
  KEY `fk_reports_assigned_to` (`assigned_to`),
  KEY `fk_reports_resolved_by` (`resolved_by`),
  CONSTRAINT `fk_reports_assigned_to` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_reports_resolved_by` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `reports_ibfk_1` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reports_ibfk_2` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `reports_ibfk_3` FOREIGN KEY (`assigned_lea_id`) REFERENCES `law_enforcement_agencies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Stolen/lost/found reports with case IDs';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reports`
--

LOCK TABLES `reports` WRITE;
/*!40000 ALTER TABLE `reports` DISABLE KEYS */;
/*!40000 ALTER TABLE `reports` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = cp850 */ ;
/*!50003 SET character_set_results = cp850 */ ;
/*!50003 SET collation_connection  = cp850_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER reports_audit_insert 
AFTER INSERT ON reports 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, ip_address)
    VALUES (NEW.reporter_id, 'INSERT', 'reports', NEW.id, JSON_OBJECT(
        'case_id', NEW.case_id,
        'report_type', NEW.report_type,
        'device_id', NEW.device_id,
        'status', NEW.status
    ), @client_ip);
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = cp850 */ ;
/*!50003 SET character_set_results = cp850 */ ;
/*!50003 SET collation_connection  = cp850_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER reports_audit_update 
AFTER UPDATE ON reports 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address)
    VALUES (NEW.reporter_id, 'UPDATE', 'reports', NEW.id,
        JSON_OBJECT('status', OLD.status, 'lea_notes', OLD.lea_notes),
        JSON_OBJECT('status', NEW.status, 'lea_notes', NEW.lea_notes),
        @client_ip);
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `seller_bank_accounts`
--

DROP TABLE IF EXISTS `seller_bank_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `seller_bank_accounts` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `bank_name` varchar(255) NOT NULL,
  `bank_code` varchar(10) NOT NULL,
  `account_number` varchar(20) NOT NULL,
  `account_name` varchar(255) NOT NULL,
  `recipient_code` varchar(255) DEFAULT NULL,
  `is_verified` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `sba_fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `seller_bank_accounts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `seller_bank_accounts`
--

LOCK TABLES `seller_bank_accounts` WRITE;
/*!40000 ALTER TABLE `seller_bank_accounts` DISABLE KEYS */;
/*!40000 ALTER TABLE `seller_bank_accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sessions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(255) NOT NULL,
  `token` varchar(512) NOT NULL,
  `ip_address` varchar(64) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sessions`
--

LOCK TABLES `sessions` WRITE;
/*!40000 ALTER TABLE `sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sms_notifications`
--

DROP TABLE IF EXISTS `sms_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sms_notifications` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(255) DEFAULT NULL,
  `phone` varchar(50) NOT NULL,
  `message` text NOT NULL,
  `status` enum('pending','sent','failed') DEFAULT 'pending',
  `provider_response` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sms_notifications`
--

LOCK TABLES `sms_notifications` WRITE;
/*!40000 ALTER TABLE `sms_notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `sms_notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `suspicious_activity_alerts`
--

DROP TABLE IF EXISTS `suspicious_activity_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `suspicious_activity_alerts` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `device_check_id` varchar(36) NOT NULL,
  `device_id` varchar(36) DEFAULT NULL,
  `alert_type` enum('reported_device_check','multiple_checks_same_ip','multiple_checks_same_location','anonymous_check_reported_device','location_mismatch') NOT NULL,
  `severity` enum('low','medium','high','critical') DEFAULT 'medium',
  `description` text NOT NULL,
  `auto_generated` tinyint(1) DEFAULT 1,
  `reviewed_by` varchar(36) DEFAULT NULL COMMENT 'Admin/LEA who reviewed',
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `status` enum('pending','investigating','resolved','false_positive') DEFAULT 'pending',
  `resolution_notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `reviewed_by` (`reviewed_by`),
  KEY `idx_suspicious_alerts_device_check_id` (`device_check_id`),
  KEY `idx_suspicious_alerts_device_id` (`device_id`),
  KEY `idx_suspicious_alerts_alert_type` (`alert_type`),
  KEY `idx_suspicious_alerts_severity` (`severity`),
  KEY `idx_suspicious_alerts_status` (`status`),
  CONSTRAINT `suspicious_activity_alerts_ibfk_1` FOREIGN KEY (`device_check_id`) REFERENCES `device_checks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `suspicious_activity_alerts_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `suspicious_activity_alerts_ibfk_3` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Suspicious activity alerts generated from device checks';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `suspicious_activity_alerts`
--

LOCK TABLES `suspicious_activity_alerts` WRITE;
/*!40000 ALTER TABLE `suspicious_activity_alerts` DISABLE KEYS */;
/*!40000 ALTER TABLE `suspicious_activity_alerts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `system_alerts`
--

DROP TABLE IF EXISTS `system_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `system_alerts` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `alert_type` enum('security','system','user_activity','data_integrity') NOT NULL,
  `severity` enum('low','medium','high','critical') NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `is_resolved` tinyint(1) DEFAULT 0,
  `resolved_by` varchar(36) DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `resolved_by` (`resolved_by`),
  KEY `idx_alert_type` (`alert_type`),
  KEY `idx_severity` (`severity`),
  KEY `idx_is_resolved` (`is_resolved`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `system_alerts_ibfk_1` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='System alerts and notifications for admins';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system_alerts`
--

LOCK TABLES `system_alerts` WRITE;
/*!40000 ALTER TABLE `system_alerts` DISABLE KEYS */;
/*!40000 ALTER TABLE `system_alerts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `system_notifications`
--

DROP TABLE IF EXISTS `system_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `system_notifications` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `recipient_user_id` varchar(36) DEFAULT NULL COMMENT 'User recipient (NULL for LEA/admin broadcasts)',
  `recipient_role` enum('user','admin','lea','business') DEFAULT NULL COMMENT 'Role-based notifications',
  `recipient_region` varchar(100) DEFAULT NULL COMMENT 'Region-based notifications for LEAs',
  `notification_type` enum('device_check','device_report','suspicious_activity','transfer_request','verification_update','lea_case_update','system_alert') NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `priority` enum('low','medium','high','urgent') DEFAULT 'medium',
  `device_id` varchar(36) DEFAULT NULL,
  `report_id` varchar(36) DEFAULT NULL,
  `device_check_id` varchar(36) DEFAULT NULL,
  `suspicious_alert_id` varchar(36) DEFAULT NULL,
  `send_email` tinyint(1) DEFAULT 1,
  `send_sms` tinyint(1) DEFAULT 0,
  `send_push` tinyint(1) DEFAULT 1,
  `email_sent` tinyint(1) DEFAULT 0,
  `email_sent_at` timestamp NULL DEFAULT NULL,
  `sms_sent` tinyint(1) DEFAULT 0,
  `sms_sent_at` timestamp NULL DEFAULT NULL,
  `push_sent` tinyint(1) DEFAULT 0,
  `push_sent_at` timestamp NULL DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `read_at` timestamp NULL DEFAULT NULL,
  `action_url` varchar(500) DEFAULT NULL,
  `action_text` varchar(100) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `expires_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `device_id` (`device_id`),
  KEY `report_id` (`report_id`),
  KEY `device_check_id` (`device_check_id`),
  KEY `suspicious_alert_id` (`suspicious_alert_id`),
  KEY `idx_system_notifications_recipient_user_id` (`recipient_user_id`),
  KEY `idx_system_notifications_recipient_role` (`recipient_role`),
  KEY `idx_system_notifications_notification_type` (`notification_type`),
  KEY `idx_system_notifications_priority` (`priority`),
  KEY `idx_system_notifications_is_read` (`is_read`),
  KEY `idx_system_notifications_created_at` (`created_at`),
  CONSTRAINT `system_notifications_ibfk_1` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `system_notifications_ibfk_2` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `system_notifications_ibfk_3` FOREIGN KEY (`report_id`) REFERENCES `reports` (`id`) ON DELETE SET NULL,
  CONSTRAINT `system_notifications_ibfk_4` FOREIGN KEY (`device_check_id`) REFERENCES `device_checks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `system_notifications_ibfk_5` FOREIGN KEY (`suspicious_alert_id`) REFERENCES `suspicious_activity_alerts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='System-generated notifications with multi-channel delivery';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system_notifications`
--

LOCK TABLES `system_notifications` WRITE;
/*!40000 ALTER TABLE `system_notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `system_notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `system_settings`
--

DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `system_settings` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `setting_type` enum('string','number','boolean','json') DEFAULT 'string',
  `description` text DEFAULT NULL,
  `is_public` tinyint(1) DEFAULT 0 COMMENT 'Can be accessed by non-admin users',
  `updated_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `updated_by` (`updated_by`),
  KEY `idx_setting_key` (`setting_key`),
  KEY `idx_is_public` (`is_public`),
  CONSTRAINT `system_settings_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='System configuration settings';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system_settings`
--

LOCK TABLES `system_settings` WRITE;
/*!40000 ALTER TABLE `system_settings` DISABLE KEYS */;
INSERT INTO `system_settings` VALUES ('139bfdc3-b48e-11f0-8c8f-b4b6862aa243','app_name','Prove Ownership Device Registry','string','Application name',0,NULL,'2025-10-29 06:11:18','2025-10-29 06:11:18'),('13a91ba6-b48e-11f0-8c8f-b4b6862aa243','app_version','1.0.0','string','Application version',0,NULL,'2025-10-29 06:11:18','2025-10-29 06:11:18'),('13aaaef3-b48e-11f0-8c8f-b4b6862aa243','maintenance_mode','false','boolean','Enable maintenance mode',0,NULL,'2025-10-29 06:11:18','2025-10-29 06:11:18'),('13bc41e3-b48e-11f0-8c8f-b4b6862aa243','email_verification_required','true','boolean','Require email verification for new accounts',0,NULL,'2025-10-29 06:11:18','2025-10-29 06:11:18'),('13be240c-b48e-11f0-8c8f-b4b6862aa243','max_devices_per_business','100','number','Maximum devices per business user',0,NULL,'2025-10-29 06:11:18','2025-10-29 06:11:18'),('13bee6d4-b48e-11f0-8c8f-b4b6862aa243','device_verification_required','true','boolean','Require admin verification for devices',0,NULL,'2025-10-29 06:11:18','2025-10-29 06:11:18'),('13c195a8-b48e-11f0-8c8f-b4b6862aa243','report_auto_assignment','true','boolean','Auto-assign reports to LEA users',0,NULL,'2025-10-29 06:11:18','2025-10-29 06:11:18'),('13d116a9-b48e-11f0-8c8f-b4b6862aa243','notification_rate_limit','10','number','Max notifications per user per hour',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13d1c931-b48e-11f0-8c8f-b4b6862aa243','session_timeout_minutes','60','number','Default session timeout in minutes',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13d8f162-b48e-11f0-8c8f-b4b6862aa243','password_min_length','8','number','Minimum password length',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13da70e3-b48e-11f0-8c8f-b4b6862aa243','failed_login_attempts','5','number','Max failed login attempts before lockout',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13db3ccd-b48e-11f0-8c8f-b4b6862aa243','account_lockout_minutes','30','number','Account lockout duration in minutes',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13dc7f6a-b48e-11f0-8c8f-b4b6862aa243','api_rate_limit_per_minute','100','number','API requests per minute per user',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13dd7117-b48e-11f0-8c8f-b4b6862aa243','backup_retention_days','30','number','Database backup retention period',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13de58a5-b48e-11f0-8c8f-b4b6862aa243','log_retention_days','90','number','Audit log retention period',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13df5b44-b48e-11f0-8c8f-b4b6862aa243','file_upload_max_size','5242880','number','Maximum file upload size in bytes (5MB)',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('13e02096-b48e-11f0-8c8f-b4b6862aa243','allowed_file_types','jpg,jpeg,png,gif,pdf,doc,docx','string','Allowed file upload types',0,NULL,'2025-10-29 06:11:19','2025-10-29 06:11:19'),('80bce0fb-7095-11f1-8c3f-68ecc5fe6cd9','platform_fee_percent','2.50','number','Platform fee percentage deducted from seller payout on each sale',0,NULL,'2026-06-25 12:57:41','2026-06-25 12:57:41'),('8e44665a-aac4-11f0-8805-b4b6862aa243','max_devices_per_user','50','number','Maximum devices a user can register',0,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e4490ee-aac4-11f0-8805-b4b6862aa243','verification_timeout_days','7','number','Days before unverified devices are flagged',0,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e449216-aac4-11f0-8805-b4b6862aa243','auto_assign_lea','true','boolean','Automatically assign LEA to new reports',0,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e449352-aac4-11f0-8805-b4b6862aa243','public_check_enabled','true','boolean','Enable public device checking',1,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e449415-aac4-11f0-8805-b4b6862aa243','notification_email_enabled','true','boolean','Enable email notifications',0,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e449555-aac4-11f0-8805-b4b6862aa243','notification_sms_enabled','false','boolean','Enable SMS notifications',0,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e449649-aac4-11f0-8805-b4b6862aa243','system_maintenance_mode','false','boolean','System maintenance mode',1,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e449727-aac4-11f0-8805-b4b6862aa243','registration_enabled','true','boolean','Allow new user registrations',1,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e449821-aac4-11f0-8805-b4b6862aa243','device_registration_enabled','true','boolean','Allow new device registrations',1,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51'),('8e4498b3-aac4-11f0-8805-b4b6862aa243','transfer_enabled','true','boolean','Allow device transfers',1,NULL,'2025-10-16 19:15:51','2025-10-16 19:15:51');
/*!40000 ALTER TABLE `system_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transactions`
--

DROP TABLE IF EXISTS `transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `transactions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `currency` varchar(3) DEFAULT 'NGN',
  `type` enum('marketplace_purchase','marketplace_sale','subscription','service_fee','recovery_service') NOT NULL,
  `status` enum('pending','completed','failed','refunded') DEFAULT 'pending',
  `reference` varchar(255) DEFAULT NULL,
  `related_entity_type` enum('marketplace_listing','listing','recovery','subscription') DEFAULT NULL,
  `related_entity_id` varchar(36) DEFAULT NULL,
  `payment_method_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `payment_method_id` (`payment_method_id`),
  KEY `idx_transactions_user` (`user_id`),
  KEY `idx_transactions_status` (`status`),
  KEY `idx_transactions_reference` (`reference`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `transactions_ibfk_2` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transactions`
--

LOCK TABLES `transactions` WRITE;
/*!40000 ALTER TABLE `transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_preferences`
--

DROP TABLE IF EXISTS `user_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_preferences` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `dashboard_layout` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`dashboard_layout`)),
  `notification_settings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`notification_settings`)),
  `privacy_settings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`privacy_settings`)),
  `display_preferences` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`display_preferences`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `user_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_preferences`
--

LOCK TABLES `user_preferences` WRITE;
/*!40000 ALTER TABLE `user_preferences` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_preferences` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_sessions`
--

DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_sessions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `session_token` varchar(512) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `mac_address` varchar(255) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_activity` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `expires_at` timestamp NOT NULL DEFAULT (current_timestamp() + interval 1 hour),
  `is_current` tinyint(1) DEFAULT 0,
  `device_fingerprint` text DEFAULT NULL,
  `is_trusted` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_last_activity` (`last_activity`),
  CONSTRAINT `user_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_sessions`
--

LOCK TABLES `user_sessions` WRITE;
/*!40000 ALTER TABLE `user_sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_suspensions`
--

DROP TABLE IF EXISTS `user_suspensions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_suspensions` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `user_id` varchar(36) NOT NULL,
  `suspended_by` varchar(36) NOT NULL,
  `reason` text NOT NULL,
  `expires_at` timestamp NULL DEFAULT NULL COMMENT 'NULL for permanent suspension',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_suspended_by` (`suspended_by`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `user_suspensions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_suspensions_ibfk_2` FOREIGN KEY (`suspended_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User account suspensions';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_suspensions`
--

LOCK TABLES `user_suspensions` WRITE;
/*!40000 ALTER TABLE `user_suspensions` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_suspensions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `role` enum('user','business','admin','lea') DEFAULT 'user',
  `verified_at` timestamp NULL DEFAULT NULL,
  `id_document_url` text DEFAULT NULL,
  `region` varchar(100) DEFAULT NULL COMMENT 'For LEA mapping',
  `two_fa_enabled` tinyint(1) DEFAULT 0,
  `two_fa_secret` varchar(255) DEFAULT NULL COMMENT 'Encrypted 2FA secret',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `profile_image_url` varchar(255) DEFAULT NULL,
  `two_factor_enabled` tinyint(1) DEFAULT 0,
  `theme_preference` enum('light','dark','auto') DEFAULT 'light',
  `language_preference` varchar(5) DEFAULT 'en',
  `timezone` varchar(50) DEFAULT 'Africa/Lagos',
  `email_notifications` tinyint(1) DEFAULT 1,
  `sms_notifications` tinyint(1) DEFAULT 0,
  `push_notifications` tinyint(1) DEFAULT 1,
  `device_alerts` tinyint(1) DEFAULT 1,
  `transfer_notifications` tinyint(1) DEFAULT 1,
  `verification_notifications` tinyint(1) DEFAULT 1,
  `report_updates` tinyint(1) DEFAULT 1,
  `marketing_emails` tinyint(1) DEFAULT 0,
  `profile_visibility` enum('public','private','contacts') DEFAULT 'private',
  `show_online_status` tinyint(1) DEFAULT 1,
  `allow_contact_from_strangers` tinyint(1) DEFAULT 0,
  `data_sharing_consent` tinyint(1) DEFAULT 0,
  `analytics_consent` tinyint(1) DEFAULT 1,
  `session_timeout` int(11) DEFAULT 60,
  `auto_logout_enabled` tinyint(1) DEFAULT 1,
  `require_password_change` tinyint(1) DEFAULT 0,
  `login_count` int(11) DEFAULT 0,
  `last_login_at` timestamp NULL DEFAULT NULL,
  `kyc_status` enum('unverified','pending','verified','failed') DEFAULT 'unverified',
  `is_verified` tinyint(1) DEFAULT 0,
  `verification_badge_visible` tinyint(1) DEFAULT 0,
  `caution_flag` tinyint(1) DEFAULT 0,
  `verified_full_name` varchar(255) DEFAULT NULL,
  `verified_dob` date DEFAULT NULL,
  `verified_gender` varchar(50) DEFAULT NULL,
  `verified_photo_url` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `phone` (`phone`),
  KEY `idx_email` (`email`),
  KEY `idx_role` (`role`),
  KEY `idx_region` (`region`),
  KEY `idx_users_role_created` (`role`,`created_at`),
  KEY `idx_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_created_at` (`created_at`),
  KEY `idx_users_verified_at` (`verified_at`),
  KEY `idx_users_region` (`region`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User accounts with roles and regions';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary table structure for view `v_device_summary`
--

DROP TABLE IF EXISTS `v_device_summary`;
/*!50001 DROP VIEW IF EXISTS `v_device_summary`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `v_device_summary` AS SELECT
 1 AS `id`,
  1 AS `brand`,
  1 AS `model`,
  1 AS `status`,
  1 AS `created_at`,
  1 AS `verified_at`,
  1 AS `owner_name`,
  1 AS `owner_email`,
  1 AS `check_count`,
  1 AS `last_checked_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_security_events`
--

DROP TABLE IF EXISTS `v_security_events`;
/*!50001 DROP VIEW IF EXISTS `v_security_events`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `v_security_events` AS SELECT
 1 AS `id`,
  1 AS `user_id`,
  1 AS `user_name`,
  1 AS `user_email`,
  1 AS `action`,
  1 AS `resource_type`,
  1 AS `details`,
  1 AS `ip_address`,
  1 AS `severity`,
  1 AS `status`,
  1 AS `created_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_user_stats`
--

DROP TABLE IF EXISTS `v_user_stats`;
/*!50001 DROP VIEW IF EXISTS `v_user_stats`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `v_user_stats` AS SELECT
 1 AS `id`,
  1 AS `name`,
  1 AS `email`,
  1 AS `role`,
  1 AS `created_at`,
  1 AS `verified_at`,
  1 AS `device_count`,
  1 AS `verified_devices`,
  1 AS `report_count`,
  1 AS `open_reports`,
  1 AS `last_activity` */;
SET character_set_client = @saved_cs_client;

--
-- Dumping routines for database 'check_it_registry'
--
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 DROP FUNCTION IF EXISTS `generate_case_id` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = cp850 */ ;
/*!50003 SET character_set_results = cp850 */ ;
/*!50003 SET collation_connection  = cp850_general_ci */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`localhost` FUNCTION `generate_case_id`() RETURNS varchar(20) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci
    READS SQL DATA
    DETERMINISTIC
BEGIN
    DECLARE case_id VARCHAR(20);
    DECLARE counter INT DEFAULT 0;
    
    REPEAT
        SET case_id = CONCAT('CASE-', YEAR(NOW()), '-', LPAD(FLOOR(RAND() * 999999), 6, '0'));
        SET counter = counter + 1;
    UNTIL NOT EXISTS (SELECT 1 FROM reports WHERE reports.case_id = case_id) OR counter > 100
    END REPEAT;
    
    RETURN case_id;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 DROP FUNCTION IF EXISTS `is_user_suspended` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = cp850 */ ;
/*!50003 SET character_set_results = cp850 */ ;
/*!50003 SET collation_connection  = cp850_general_ci */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`localhost` FUNCTION `is_user_suspended`(user_id_param VARCHAR(36)) RETURNS tinyint(1)
    READS SQL DATA
    DETERMINISTIC
BEGIN
    DECLARE suspension_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO suspension_count
    FROM user_suspensions
    WHERE user_id = user_id_param
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW());
    
    RETURN suspension_count > 0;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Final view structure for view `active_suspensions`
--

/*!50001 DROP VIEW IF EXISTS `active_suspensions`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = cp850 */;
/*!50001 SET character_set_results     = cp850 */;
/*!50001 SET collation_connection      = cp850_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `active_suspensions` AS select `us`.`id` AS `id`,`us`.`user_id` AS `user_id`,`us`.`suspended_by` AS `suspended_by`,`us`.`reason` AS `reason`,`us`.`expires_at` AS `expires_at`,`us`.`is_active` AS `is_active`,`us`.`created_at` AS `created_at`,`us`.`updated_at` AS `updated_at`,`u`.`name` AS `user_name`,`u`.`email` AS `user_email`,`admin`.`name` AS `suspended_by_name` from ((`user_suspensions` `us` join `users` `u` on(`us`.`user_id` = `u`.`id`)) join `users` `admin` on(`us`.`suspended_by` = `admin`.`id`)) where `us`.`is_active` = 1 and (`us`.`expires_at` is null or `us`.`expires_at` > current_timestamp()) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `admin_dashboard_summary`
--

/*!50001 DROP VIEW IF EXISTS `admin_dashboard_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = cp850 */;
/*!50001 SET character_set_results     = cp850 */;
/*!50001 SET collation_connection      = cp850_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `admin_dashboard_summary` AS select (select count(0) from `users`) AS `total_users`,(select count(0) from `users` where `users`.`role` = 'admin') AS `admin_users`,(select count(0) from `users` where `users`.`role` = 'lea') AS `lea_users`,(select count(0) from `devices`) AS `total_devices`,(select count(0) from `devices` where `devices`.`status` = 'unverified') AS `pending_verifications`,(select count(0) from `devices` where `devices`.`status` = 'verified') AS `verified_devices`,(select count(0) from `devices` where `devices`.`status` in ('stolen','lost')) AS `stolen_lost_devices`,(select count(0) from `reports`) AS `total_reports`,(select count(0) from `reports` where `reports`.`status` = 'open') AS `open_reports`,(select count(0) from `reports` where `reports`.`status` = 'resolved') AS `resolved_reports`,(select count(0) from `notifications` where `notifications`.`status` = 'pending') AS `pending_notifications`,(select count(0) from `notifications` where `notifications`.`status` = 'failed') AS `failed_notifications`,(select count(0) from `active_suspensions`) AS `active_suspensions`,(select count(0) from `system_alerts` where `system_alerts`.`is_resolved` = 0) AS `unresolved_alerts` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `device_summary`
--

/*!50001 DROP VIEW IF EXISTS `device_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = cp850 */;
/*!50001 SET character_set_results     = cp850 */;
/*!50001 SET collation_connection      = cp850_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `device_summary` AS select `d`.`id` AS `id`,`d`.`brand` AS `brand`,`d`.`model` AS `model`,`d`.`imei` AS `imei`,`d`.`serial` AS `serial`,`d`.`status` AS `status`,`u`.`name` AS `owner_name`,`u`.`email` AS `owner_email`,`d`.`created_at` AS `created_at`,`d`.`verified_at` AS `verified_at`,(select count(0) from `reports` `r` where `r`.`device_id` = `d`.`id` and `r`.`status` = 'open') AS `active_reports` from (`devices` `d` join `users` `u` on(`d`.`user_id` = `u`.`id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `report_summary`
--

/*!50001 DROP VIEW IF EXISTS `report_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = cp850 */;
/*!50001 SET character_set_results     = cp850 */;
/*!50001 SET collation_connection      = cp850_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `report_summary` AS select `r`.`id` AS `id`,`r`.`case_id` AS `case_id`,`r`.`report_type` AS `report_type`,`r`.`status` AS `status`,`r`.`occurred_at` AS `occurred_at`,`r`.`location` AS `location`,`d`.`brand` AS `brand`,`d`.`model` AS `model`,`d`.`imei` AS `imei`,`d`.`serial` AS `serial`,`u`.`name` AS `reporter_name`,`u`.`email` AS `reporter_email`,`lea`.`agency_name` AS `agency_name`,`lea`.`contact_email` AS `lea_email`,`r`.`created_at` AS `created_at` from (((`reports` `r` join `devices` `d` on(`r`.`device_id` = `d`.`id`)) left join `users` `u` on(`r`.`reporter_id` = `u`.`id`)) left join `law_enforcement_agencies` `lea` on(`r`.`assigned_lea_id` = `lea`.`id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_device_summary`
--

/*!50001 DROP VIEW IF EXISTS `v_device_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `v_device_summary` AS select `d`.`id` AS `id`,`d`.`brand` AS `brand`,`d`.`model` AS `model`,`d`.`status` AS `status`,`d`.`created_at` AS `created_at`,`d`.`verified_at` AS `verified_at`,`u`.`name` AS `owner_name`,`u`.`email` AS `owner_email`,coalesce(`d`.`check_count`,0) AS `check_count`,`d`.`last_checked_at` AS `last_checked_at` from (`devices` `d` join `users` `u` on(`d`.`user_id` = `u`.`id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_security_events`
--

/*!50001 DROP VIEW IF EXISTS `v_security_events`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `v_security_events` AS select `al`.`id` AS `id`,`al`.`user_id` AS `user_id`,`u`.`name` AS `user_name`,`u`.`email` AS `user_email`,`al`.`action` AS `action`,coalesce(`al`.`resource_type`,'system') AS `resource_type`,`al`.`details` AS `details`,`al`.`ip_address` AS `ip_address`,coalesce(`al`.`severity`,'low') AS `severity`,coalesce(`al`.`status`,'success') AS `status`,`al`.`created_at` AS `created_at` from (`audit_logs` `al` left join `users` `u` on(`al`.`user_id` = `u`.`id`)) where coalesce(`al`.`severity`,'low') in ('high','critical') or `al`.`action` like '%failed%' or `al`.`action` like '%suspicious%' or coalesce(`al`.`resource_type`,'system') = 'auth' order by `al`.`created_at` desc */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_user_stats`
--

/*!50001 DROP VIEW IF EXISTS `v_user_stats`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `v_user_stats` AS select `u`.`id` AS `id`,`u`.`name` AS `name`,`u`.`email` AS `email`,`u`.`role` AS `role`,`u`.`created_at` AS `created_at`,`u`.`verified_at` AS `verified_at`,count(distinct `d`.`id`) AS `device_count`,count(distinct case when `d`.`status` = 'verified' then `d`.`id` end) AS `verified_devices`,count(distinct `r`.`id`) AS `report_count`,count(distinct case when `r`.`status` = 'open' then `r`.`id` end) AS `open_reports`,max(`al`.`created_at`) AS `last_activity` from (((`users` `u` left join `devices` `d` on(`u`.`id` = `d`.`user_id`)) left join `reports` `r` on(`u`.`id` = `r`.`reporter_id`)) left join `audit_logs` `al` on(`u`.`id` = `al`.`user_id`)) group by `u`.`id`,`u`.`name`,`u`.`email`,`u`.`role`,`u`.`created_at`,`u`.`verified_at` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-26 23:11:04
