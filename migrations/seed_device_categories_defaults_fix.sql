-- Safe seeding of default device categories using INSERT IGNORE per row

INSERT IGNORE INTO device_categories (category_key, label, description, active)
VALUES ('mobile_phone', 'Phone', 'Mobile phones with IMEI identifiers', 1);

INSERT IGNORE INTO device_categories (category_key, label, description, active)
VALUES ('vehicle', 'Vehicle', 'Vehicles identified by VIN/plate/chassis', 1);

INSERT IGNORE INTO device_categories (category_key, label, description, active)
VALUES ('computer', 'Computers', 'Laptops and desktops identified by serial/MAC', 1);

INSERT IGNORE INTO device_categories (category_key, label, description, active)
VALUES ('smart_watch', 'Smart Watch', 'Wearables like smart watches with serial/IMEI/MAC', 1);

INSERT IGNORE INTO device_categories (category_key, label, description, active)
VALUES ('others', 'Others', 'Other devices with generic identifiers', 1);