-- Device Categories Migration
-- Creates table and seeds initial categories for device registration

CREATE TABLE IF NOT EXISTS device_categories (
  id INT PRIMARY KEY AUTO_INCREMENT,
  category_key VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  description TEXT,
  required_fields JSON NULL,
  optional_fields JSON NULL,
  identifier_type ENUM('imei','serial','vin','generic') DEFAULT 'generic',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed initial categories (Phone, Vehicle, Computers, Smart Watch, Others)
INSERT IGNORE INTO device_categories (category_key, label, description, required_fields, optional_fields, identifier_type)
VALUES
  ('mobile_phone', 'Phone', 'Mobile phones with IMEI identifiers', JSON_ARRAY('imei','brand','model'), JSON_ARRAY('imei2','networkCarrier','operatingSystem','storageCapacity','color'), 'imei'),
  ('vehicle', 'Vehicle', 'Vehicles identified by VIN and plate', JSON_ARRAY('vin','licensePlate','year','brand','model'), JSON_ARRAY('engineNumber','registrationState','color'), 'vin'),
  ('computer', 'Computers', 'Computers identified by serial number', JSON_ARRAY('serialNumber','brand','model'), JSON_ARRAY('macAddress','processorType','operatingSystem','ramSize','color'), 'serial'),
  ('smart_watch', 'Smart Watch', 'Smart watches identified by serial number or IMEI for LTE models', JSON_ARRAY('serialNumber','brand','model'), JSON_ARRAY('imei','bluetoothMac','operatingSystem','color'), 'serial'),
  ('others', 'Others', 'Other devices with flexible identifiers', JSON_ARRAY('description','brand','model'), JSON_ARRAY('serialNumber','modelNumber','estimatedValue','color'), 'generic');