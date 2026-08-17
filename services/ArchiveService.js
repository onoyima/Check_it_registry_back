const Database = require('../config');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

class ArchiveService {
  // ═══════════════════════════════════════════════════════════════
  // SECURITY QUESTIONS
  // ═══════════════════════════════════════════════════════════════

  static async setupSecurityQuestion(userId, question, answer) {
    const id = Database.generateUUID();
    const answerHash = await bcrypt.hash(answer.toLowerCase().trim(), 12);
    // Remove existing questions for this user
    await Database.query('DELETE FROM security_questions WHERE user_id = ?', [userId]);
    await Database.insert('security_questions', { id, user_id: userId, question, answer_hash: answerHash });
    return { id, question };
  }

  static async verifySecurityQuestion(userId, answer) {
    const row = await Database.queryOne(
      'SELECT id, question, answer_hash FROM security_questions WHERE user_id = ?', [userId]
    );
    if (!row) return { verified: false, error: 'No security question configured' };
    const match = await bcrypt.compare(answer.toLowerCase().trim(), row.answer_hash);
    return { verified: match, question: row.question, error: match ? null : 'Incorrect answer' };
  }

  static async getSecurityQuestion(userId) {
    const row = await Database.queryOne(
      'SELECT id, question FROM security_questions WHERE user_id = ?', [userId]
    );
    return row || null;
  }

  static async hasSecurityQuestion(userId) {
    const row = await Database.queryOne('SELECT id FROM security_questions WHERE user_id = ?', [userId]);
    return !!row;
  }

  // ═══════════════════════════════════════════════════════════════
  // USER SOFT DELETE + ARCHIVE
  // ═══════════════════════════════════════════════════════════════

  static async softDeleteUser(userId, deletionReason, securityVerified, otpVerified, actorId = null) {
    return await Database.transaction(async (conn) => {
      // Get full user snapshot
      const user = await Database.queryOne(
        `SELECT id, name, first_name, middle_name, last_name, email, phone, role, region,
                kyc_status, is_verified, created_at, last_login_at
         FROM users WHERE id = ?`, [userId]
      );
      if (!user) throw new Error('User not found');
      if (user.role === 'admin') throw new Error('Cannot delete admin accounts via this flow');

      // Count related records
      const [deviceCount] = await Database.query('SELECT COUNT(*) as c FROM devices WHERE user_id = ?', [userId]);
      const [reportCount] = await Database.query('SELECT COUNT(*) as c FROM reports WHERE reporter_id = ?', [userId]);
      const [transferCount] = await Database.query(
        'SELECT COUNT(*) as c FROM device_transfers WHERE from_user_id = ? OR to_user_id = ?', [userId, userId]
      );
      const [txCount] = await Database.query('SELECT COUNT(*) as c FROM transactions WHERE user_id = ?', [userId]);

      // Create archive record
      const archiveId = Database.generateUUID();
      await Database.insert('account_deletions', {
        id: archiveId,
        user_id: userId,
        original_email: user.email,
        original_name: user.name,
        role: user.role,
        deletion_reason: deletionReason,
        security_question_verified: securityVerified ? 1 : 0,
        otp_verified: otpVerified ? 1 : 0,
        final_confirmation: 1,
        device_count: deviceCount.c,
        report_count: reportCount.c,
        transfer_count: transferCount.c,
        transaction_count: txCount.c,
        snapshot: JSON.stringify(user),
        deleted_at: new Date(),
        status: 'deleted',
      });

      // Store original email before renaming
      const originalEmail = user.email;
      const timestamp = Date.now();

      // Rename email to free unique constraint for re-registration
      const deletedEmail = `deleted_${timestamp}_${user.email}`;
      const deletedName = `[DELETED] ${user.name}`;

      await Database.query(
        `UPDATE users SET
           email = ?, name = ?, deleted_at = NOW(),
           deletion_reason = ?, original_email = ?
         WHERE id = ?`,
        [deletedEmail, deletedName, deletionReason, originalEmail, userId]
      );

      // Deactivate sessions
      await Database.query('UPDATE user_sessions SET is_active = 0 WHERE user_id = ?', [userId]);

      // Audit log
      await Database.logAudit(
        actorId || userId, 'ACCOUNT_DELETED', 'users', userId,
        { email: originalEmail, role: user.role },
        { reason: deletionReason, archive_id: archiveId },
        null
      );

      return { archiveId, originalEmail, deviceCount: deviceCount.c };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DEVICE SOFT DELETE + ARCHIVE
  // ═══════════════════════════════════════════════════════════════

  static async softDeleteDevice(deviceId, userId, deletionReason) {
    return await Database.transaction(async (conn) => {
      const device = await Database.queryOne(
        'SELECT * FROM devices WHERE id = ? AND user_id = ?', [deviceId, userId]
      );
      if (!device) throw new Error('Device not found or not owned');

      const [reportCount] = await Database.query('SELECT COUNT(*) as c FROM reports WHERE device_id = ?', [deviceId]);
      const [transferCount] = await Database.query('SELECT COUNT(*) as c FROM device_transfers WHERE device_id = ?', [deviceId]);

      // Archive
      const archiveId = Database.generateUUID();
      await Database.insert('device_deletions', {
        id: archiveId,
        device_id: deviceId,
        user_id: userId,
        original_imei: device.imei,
        original_serial: device.serial,
        brand: device.brand,
        model: device.model,
        category: device.category,
        status_before_delete: device.status,
        deletion_reason: deletionReason,
        report_count: reportCount.c,
        transfer_count: transferCount.c,
        snapshot: JSON.stringify(device),
        deleted_at: new Date(),
        status: 'deleted',
      });

      // Null out unique identifiers to free constraints, set deleted_at
      await Database.query(
        `UPDATE devices SET
           deleted_at = NOW(), deletion_reason = ?,
           original_imei = COALESCE(original_imei, imei),
           original_serial = COALESCE(original_serial, serial),
           imei = NULL, serial = NULL
         WHERE id = ?`,
        [deletionReason, deviceId]
      );

      // Record in ownership history
      await Database.insert('device_ownership_history', {
        id: Database.generateUUID(),
        device_id: deviceId,
        user_id: userId,
        action: 'deleted',
        metadata: JSON.stringify({ reason: deletionReason, archive_id: archiveId }),
      });

      // Audit
      await Database.logAudit(userId, 'DEVICE_DELETED', 'devices', deviceId,
        { brand: device.brand, model: device.model, imei: device.imei },
        { reason: deletionReason, archive_id: archiveId }, null);

      return { archiveId, brand: device.brand, model: device.model };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ADMIN RESTORE
  // ═══════════════════════════════════════════════════════════════

  static async restoreUser(archiveId, adminId) {
    return await Database.transaction(async (conn) => {
      const archive = await Database.queryOne(
        'SELECT * FROM account_deletions WHERE id = ? AND status = ?', [archiveId, 'deleted']
      );
      if (!archive) throw new Error('Archive record not found or already restored');

      const userId = archive.user_id;

      // Check if a new account with the same email already exists
      const existingActive = await Database.queryOne(
        'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [archive.original_email]
      );
      if (existingActive) throw new Error('An active account with this email already exists');

      // Restore the user record
      const deletedEmailPattern = `deleted_%_${archive.original_email}`;
      await Database.query(
        `UPDATE users SET
           email = ?, name = ?, deleted_at = NULL, deletion_reason = NULL, original_email = NULL
         WHERE id = ? AND email LIKE ?`,
        [archive.original_email, archive.original_name, userId, deletedEmailPattern]
      );

      // Reactivate sessions
      await Database.query('UPDATE user_sessions SET is_active = 1 WHERE user_id = ?', [userId]);

      // Update archive
      await Database.query(
        'UPDATE account_deletions SET status = ?, restored_at = NOW(), restored_by = ? WHERE id = ?',
        ['restored', adminId, archiveId]
      );

      // Audit
      await Database.logAudit(adminId, 'ACCOUNT_RESTORED', 'users', userId,
        { archive_id: archiveId, email: archive.original_email },
        { restored_by: adminId }, null);

      return { userId, email: archive.original_email };
    });
  }

  static async restoreDevice(archiveId, adminId) {
    return await Database.transaction(async (conn) => {
      const archive = await Database.queryOne(
        'SELECT * FROM device_deletions WHERE id = ? AND status = ?', [archiveId, 'deleted']
      );
      if (!archive) throw new Error('Archive record not found or already restored');

      const deviceId = archive.device_id;

      // Check if device is already actively registered
      const existingActive = await Database.queryOne(
        'SELECT id FROM devices WHERE (imei = ? OR serial = ?) AND deleted_at IS NULL AND imei IS NOT NULL',
        [archive.original_imei, archive.original_serial]
      );
      if (existingActive) throw new Error('This device is already actively registered');

      // Restore
      await Database.query(
        `UPDATE devices SET
           deleted_at = NULL, deletion_reason = NULL,
           imei = COALESCE(?, imei), serial = COALESCE(?, serial),
           original_imei = NULL, original_serial = NULL
         WHERE id = ?`,
        [archive.original_imei, archive.original_serial, deviceId]
      );

      // Update archive
      await Database.query(
        'UPDATE device_deletions SET status = ?, restored_at = NOW(), restored_by = ? WHERE id = ?',
        ['restored', adminId, archiveId]
      );

      // Ownership history
      await Database.insert('device_ownership_history', {
        id: Database.generateUUID(),
        device_id: deviceId,
        user_id: archive.user_id,
        action: 'restored',
        metadata: JSON.stringify({ archive_id: archiveId, restored_by: adminId }),
      });

      // Audit
      await Database.logAudit(adminId, 'DEVICE_RESTORED', 'devices', deviceId,
        { archive_id: archiveId },
        { restored_by: adminId }, null);

      return { deviceId, brand: archive.brand, model: archive.model };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ADMIN QUERIES
  // ═══════════════════════════════════════════════════════════════

  static async getDeletedUsers(page = 1, limit = 20, search = '') {
    const offset = (page - 1) * limit;
    let where = "u.deleted_at IS NOT NULL";
    const params = [];
    if (search) {
      where += " AND (u.original_email LIKE ? OR u.original_name LIKE ? OR u.id LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    const [{ total }] = await Database.query(`SELECT COUNT(*) as total FROM users u WHERE ${where}`, params);
    const users = await Database.query(
      `SELECT u.id, u.original_email, u.original_name, u.name, u.role, u.deleted_at, u.deletion_reason,
              u.created_at, u.last_login_at
       FROM users u WHERE ${where} ORDER BY u.deleted_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  static async getDeletedDevices(page = 1, limit = 20, search = '') {
    const offset = (page - 1) * limit;
    let where = "d.deleted_at IS NOT NULL";
    const params = [];
    if (search) {
      where += " AND (d.original_imei LIKE ? OR d.original_serial LIKE ? OR d.brand LIKE ? OR d.model LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    const [{ total }] = await Database.query(`SELECT COUNT(*) as total FROM devices d WHERE ${where}`, params);
    const devices = await Database.query(
      `SELECT d.id, d.original_imei, d.original_serial, d.brand, d.model, d.category,
              d.user_id, d.deleted_at, d.deletion_reason, d.status_before_delete,
              u.original_email as owner_email, u.original_name as owner_name
       FROM devices d LEFT JOIN users u ON d.user_id = u.id
       WHERE ${where} ORDER BY d.deleted_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { devices, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  static async getDeletedAccountDetail(archiveId) {
    const archive = await Database.queryOne('SELECT * FROM account_deletions WHERE id = ?', [archiveId]);
    if (!archive) return null;
    // Get current user status
    const user = await Database.queryOne(
      'SELECT id, email, name, deleted_at, created_at FROM users WHERE id = ?', [archive.user_id]
    );
    // Get devices
    const devices = await Database.query(
      'SELECT id, brand, model, imei, serial, status, created_at FROM devices WHERE user_id = ?',
      [archive.user_id]
    );
    // Get audit trail
    const audit = await Database.query(
      'SELECT * FROM audit_logs WHERE record_id = ? ORDER BY created_at DESC LIMIT 50',
      [archive.user_id]
    );
    return { archive, user, devices, audit };
  }

  static async getDeletedDeviceDetail(archiveId) {
    const archive = await Database.queryOne('SELECT * FROM device_deletions WHERE id = ?', [archiveId]);
    if (!archive) return null;
    // Ownership history
    const history = await Database.query(
      'SELECT * FROM device_ownership_history WHERE device_id = ? ORDER BY created_at ASC',
      [archive.device_id]
    );
    return { archive, history };
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA EXPORT AUDIT
  // ═══════════════════════════════════════════════════════════════

  static async logExportAudit(userId, exportType, status, filePath = null, fileSize = 0, ip = null, userAgent = null) {
    const id = Database.generateUUID();
    const data = { id, user_id: userId, export_type: exportType, status, ip_address: ip, user_agent: userAgent };
    if (filePath) data.file_path = filePath;
    if (fileSize) data.file_size = fileSize;
    if (status === 'completed') data.completed_at = new Date();
    await Database.insert('data_export_audit', data);
    return id;
  }

  static async getExportAuditLogs(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [{ total }] = await Database.query('SELECT COUNT(*) as total FROM data_export_audit');
    const logs = await Database.query(
      `SELECT dea.*, u.original_email, u.name as user_name
       FROM data_export_audit dea
       LEFT JOIN users u ON dea.user_id = u.id
       ORDER BY dea.requested_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ═══════════════════════════════════════════════════════════════
  // USER DATA EXPORT (GDPR)
  // ═══════════════════════════════════════════════════════════════

  static async generateUserDataExport(userId, exportType = 'full') {
    const data = { exported_at: new Date().toISOString(), export_type: exportType };

    if (exportType === 'full' || exportType === 'profile') {
      const user = await Database.queryOne(
        `SELECT id, name, first_name, middle_name, last_name, email, phone, role, region,
                kyc_status, is_verified, created_at, last_login_at, theme_preference,
                email_notifications, sms_notifications
         FROM users WHERE id = ?`, [userId]
      );
      data.profile = user;
    }

    if (exportType === 'full' || exportType === 'devices') {
      const devices = await Database.query(
        'SELECT id, brand, model, category, imei, serial, status, created_at FROM devices WHERE user_id = ? AND deleted_at IS NULL',
        [userId]
      );
      data.devices = devices;
    }

    if (exportType === 'full' || exportType === 'reports') {
      const reports = await Database.query(
        `SELECT r.id, r.case_id, r.report_type, r.status, r.description, r.location,
                r.occurred_at, r.created_at, d.brand, d.model
         FROM reports r LEFT JOIN devices d ON r.device_id = d.id
         WHERE r.reporter_id = ? ORDER BY r.created_at DESC`, [userId]
      );
      data.reports = reports;
    }

    if (exportType === 'full' || exportType === 'activity') {
      const activities = await Database.query(
        'SELECT action, table_name, details, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
        [userId]
      );
      data.activity = activities;
    }

    if (exportType === 'full') {
      const transfers = await Database.query(
        `SELECT t.id, t.status, d.brand, d.model, t.created_at
         FROM device_transfers t LEFT JOIN devices d ON t.device_id = d.id
         WHERE t.from_user_id = ? OR t.to_user_id = ? ORDER BY t.created_at DESC`,
        [userId, userId]
      );
      data.transfers = transfers;

      const transactions = await Database.query(
        'SELECT id, amount, type, status, description, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
        [userId]
      );
      data.transactions = transactions;

      const notifications = await Database.query(
        'SELECT id, channel, subject, message, status, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
        [userId]
      );
      data.notifications = notifications;
    }

    return data;
  }

  // ═══════════════════════════════════════════════════════════════
  // ADMIN USER/BUSINESS/LEA DASHBOARD VIEW
  // ═══════════════════════════════════════════════════════════════

  static async getUserAdminView(targetUserId) {
    const user = await Database.queryOne(
      `SELECT id, name, first_name, middle_name, last_name, email, phone, role, region,
              kyc_status, is_verified, created_at, last_login_at, deleted_at
       FROM users WHERE id = ?`, [targetUserId]
    );
    if (!user) return null;

    const devices = await Database.query(
      'SELECT id, brand, model, category, imei, serial, status, created_at FROM devices WHERE user_id = ? AND deleted_at IS NULL',
      [targetUserId]
    );
    const reports = await Database.query(
      `SELECT id, case_id, report_type, status, created_at FROM reports
       WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 20`, [targetUserId]
    );
    const transfers = await Database.query(
      `SELECT id, status, created_at FROM device_transfers
       WHERE from_user_id = ? OR to_user_id = ? ORDER BY created_at DESC LIMIT 20`,
      [targetUserId, targetUserId]
    );
    const transactions = await Database.query(
      'SELECT id, amount, type, status, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [targetUserId]
    );
    const recentActivity = await Database.query(
      'SELECT action, table_name, details, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
      [targetUserId]
    );
    const dataExports = await Database.query(
      'SELECT export_type, status, requested_at, completed_at FROM data_export_audit WHERE user_id = ? ORDER BY requested_at DESC LIMIT 10',
      [targetUserId]
    );

    // Check if they have a new account (if old was deleted)
    let newAccount = null;
    if (user.deleted_at) {
      newAccount = await Database.queryOne(
        'SELECT id, email, name, created_at FROM users WHERE email = ? AND deleted_at IS NULL',
        [user.email]
      );
    }

    return {
      user, devices, reports, transfers, transactions,
      recentActivity, dataExports, newAccount,
      stats: {
        totalDevices: devices.length,
        totalReports: reports.length,
        totalTransfers: transfers.length,
        totalTransactions: transactions.length,
      }
    };
  }

  static async getBusinessAdminView(businessUserId) {
    const base = await this.getUserAdminView(businessUserId);
    if (!base) return null;

    const profile = await Database.queryOne(
      'SELECT * FROM business_profiles WHERE user_id = ?', [businessUserId]
    );
    const onboardings = await Database.query(
      'SELECT * FROM business_onboardings WHERE business_id = ? ORDER BY created_at DESC LIMIT 20',
      [businessUserId]
    );
    const verificationAttempts = await Database.query(
      'SELECT * FROM business_verification_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [businessUserId]
    );

    return { ...base, businessProfile: profile, onboardings, verificationAttempts };
  }

  static async getLEAAdminView(leaUserId) {
    const base = await this.getUserAdminView(leaUserId);
    if (!base) return null;

    const agency = await Database.queryOne(
      'SELECT * FROM law_enforcement_agencies WHERE id = (SELECT agency_id FROM users WHERE id = ?)',
      [leaUserId]
    );

    return { ...base, agency };
  }

  // ═══════════════════════════════════════════════════════════════
  // DEVICE LIFECYCLE HISTORY
  // ═══════════════════════════════════════════════════════════════

  static async getDeviceLifecycle(deviceId) {
    const device = await Database.queryOne(
      'SELECT id, brand, model, imei, serial, status, user_id, created_at, deleted_at FROM devices WHERE id = ?',
      [deviceId]
    );
    const history = await Database.query(
      'SELECT * FROM device_ownership_history WHERE device_id = ? ORDER BY created_at ASC',
      [deviceId]
    );
    const transfers = await Database.query(
      `SELECT t.*, u1.name as from_name, u2.name as to_name
       FROM device_transfers t
       LEFT JOIN users u1 ON t.from_user_id = u1.id
       LEFT JOIN users u2 ON t.to_user_id = u2.id
       WHERE t.device_id = ? ORDER BY t.created_at ASC`,
      [deviceId]
    );
    const reports = await Database.query(
      'SELECT id, case_id, report_type, status, created_at FROM reports WHERE device_id = ? ORDER BY created_at ASC',
      [deviceId]
    );

    return { device, history, transfers, reports };
  }
}

module.exports = ArchiveService;
