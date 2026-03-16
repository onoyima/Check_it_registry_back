-- Seed default device categories if missing

INSERT INTO device_categories (category_key, label, description, active)
VALUES
  ('mobile_phone', 'Phone', 'Mobile phones with IMEI identifiers', 1),
  ('vehicle', 'Vehicle', 'Vehicles identified by VIN/plate/chassis', 1),
  ('computer', 'Computers', 'Laptops and desktops identified by serial/MAC', 1),
  ('smart_watch', 'Smart Watch', 'Wearables like smart watches with serial/IMEI/MAC', 1),
  ('others', 'Others', 'Other devices with generic identifiers', 1);