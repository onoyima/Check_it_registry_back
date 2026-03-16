const mysql = require('mysql2/promise');
const Database = require('../config');

class AuditService {
  constructor() {
    // Use the same database connection as the main Database class
    this.pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'check_it_registry',
      charset: 'utf8mb4',
      timezone: '+00:00',
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  // Extract MAC address from request headers (if available)
  extractMacAddress(req) {
    // Try to get MAC address from various headers
    const macSources = [
      req.headers['x-mac-address'],
      req.headers['x-client-mac'],
      req.headers['mac-address'],
      req.connection?.remoteAddress,
      req.socket?.remoteAddress,
      req.ip
    ];

    for (const mac of macSources) {
      if (mac && this.isValidMacAddress(mac)) {
        return mac;
      }
    }

    return null;
  }

  // Validate MAC address format
  isValidMacAddress(mac) {
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return macRegex.test(mac);
  }

  // Get client IP address
  getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           req.ip || 
           'unknown';
  }

  // Enhanced audit logging with MAC address and detailed tracking
  async logActivity(req, userId, action, tableName, recordId, oldValues = null, newValues = null, additionalData = {}) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const auditData = {
          id: Database.generateUUID(),
          user_id: userId,
          action: action,
          table_name: tableName,
          record_id: recordId,
          old_values: oldValues ? JSON.stringify(oldValues) : null,
          new_values: newValues ? JSON.stringify(newValues) : null,
          ip_address: this.getClientIP(req),
          mac_address: this.extractMacAddress(req),
          user_agent: req.headers['user-agent'] || null,
          session_id: req.session?.id || req.headers['x-session-id'] || null,
          request_method: req.method,
          request_url: req.originalUrl || req.url,
          response_status: additionalData.responseStatus || null,
          execution_time_ms: additionalData.executionTime || null,
          created_at: new Date()
        };

        await connection.execute(
          `INSERT INTO audit_logs (
            id, user_id, action, table_name, record_id, old_values, new_values,
            ip_address, mac_address, user_agent, session_id, request_method,
            request_url, response_status, execution_time_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            auditData.id, auditData.user_id, auditData.action, auditData.table_name,
            auditData.record_id, auditData.old_values, auditData.new_values,
            auditData.ip_address, auditData.mac_address, auditData.user_agent,
            auditData.session_id, auditData.request_method, auditData.request_url,
            auditData.response_status, auditData.execution_time_ms, auditData.created_at
          ]
        );

        console.log(`Audit logged: ${action} by user ${userId} from ${auditData.ip_address} (MAC: ${auditData.mac_address || 'unknown'})`);
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error logging audit activity:', error);
      // Don't throw error to avoid breaking the main request
    }
  }

  // Log device access specifically
  async logDeviceAccess(req, deviceId, userId, accessType, result, details = {}) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const accessData = {
          id: Database.generateUUID(),
          device_id: deviceId,
          user_id: userId,
          access_type: accessType,
          ip_address: this.getClientIP(req),
          mac_address: this.extractMacAddress(req),
          user_agent: req.headers['user-agent'] || null,
          session_id: req.session?.id || req.headers['x-session-id'] || null,
          result: result,
          details: Object.keys(details).length > 0 ? JSON.stringify(details) : null,
          created_at: new Date()
        };

        await connection.execute(
          `INSERT INTO device_access_logs (
            id, device_id, user_id, access_type, ip_address, mac_address,
            user_agent, session_id, result, details, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            accessData.id, accessData.device_id, accessData.user_id, accessData.access_type,
            accessData.ip_address, accessData.mac_address, accessData.user_agent,
            accessData.session_id, accessData.result, accessData.details, accessData.created_at
          ]
        );

        // Also log in main audit trail
        await this.logActivity(req, userId, `DEVICE_${accessType.toUpperCase()}`, 'devices', deviceId, null, { result, details });
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error logging device access:', error);
    }
  }

  // Track user session
  async trackSession(req, userId, sessionToken, expiresAt) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const sessionData = {
          id: Database.generateUUID(),
          user_id: userId,
          session_token: sessionToken,
          ip_address: this.getClientIP(req),
          mac_address: this.extractMacAddress(req),
          user_agent: req.headers['user-agent'] || null,
          device_fingerprint: this.generateDeviceFingerprint(req),
          location_info: null, // Could be enhanced with geolocation
          is_active: true,
          last_activity: new Date(),
          expires_at: expiresAt,
          created_at: new Date()
        };

        await connection.execute(
          `INSERT INTO user_sessions (
            id, user_id, session_token, ip_address, mac_address, user_agent,
            device_fingerprint, location_info, is_active, last_activity, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionData.id, sessionData.user_id, sessionData.session_token,
            sessionData.ip_address, sessionData.mac_address, sessionData.user_agent,
            sessionData.device_fingerprint, sessionData.location_info,
            sessionData.is_active, sessionData.last_activity, sessionData.expires_at,
            sessionData.created_at
          ]
        );

        return sessionData.id;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error tracking session:', error);
      return null;
    }
  }

  // Generate device fingerprint
  generateDeviceFingerprint(req) {
    const fingerprint = {
      userAgent: req.headers['user-agent'],
      acceptLanguage: req.headers['accept-language'],
      acceptEncoding: req.headers['accept-encoding'],
      connection: req.headers['connection'],
      ip: this.getClientIP(req),
      mac: this.extractMacAddress(req)
    };

    return JSON.stringify(fingerprint);
  }

  // Update session activity
  async updateSessionActivity(sessionId) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        await connection.execute(
          'UPDATE user_sessions SET last_activity = NOW() WHERE id = ?',
          [sessionId]
        );
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error updating session activity:', error);
    }
  }

  // Get audit logs with filtering
  async getAuditLogs(filters = {}) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        let query = `
          SELECT 
            al.*,
            u.name as user_name,
            u.email as user_email,
            u.role as user_role
          FROM audit_logs al
          LEFT JOIN users u ON al.user_id = u.id
          WHERE 1=1
        `;
        
        const params = [];

        if (filters.userId) {
          query += ' AND al.user_id = ?';
          params.push(filters.userId);
        }

        if (filters.action) {
          query += ' AND al.action = ?';
          params.push(filters.action);
        }

        if (filters.tableName) {
          query += ' AND al.table_name = ?';
          params.push(filters.tableName);
        }

        if (filters.ipAddress) {
          query += ' AND al.ip_address = ?';
          params.push(filters.ipAddress);
        }

        if (filters.macAddress) {
          query += ' AND al.mac_address = ?';
          params.push(filters.macAddress);
        }

        if (filters.dateFrom) {
          query += ' AND al.created_at >= ?';
          params.push(filters.dateFrom);
        }

        if (filters.dateTo) {
          query += ' AND al.created_at <= ?';
          params.push(filters.dateTo);
        }

        query += ' ORDER BY al.created_at DESC';

        if (filters.limit) {
          query += ' LIMIT ?';
          params.push(parseInt(filters.limit));
        }

        const [rows] = await connection.execute(query, params);
        return rows;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error getting audit logs:', error);
      throw error;
    }
  }

  // Get device access logs
  async getDeviceAccessLogs(deviceId, filters = {}) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        let query = `
          SELECT 
            dal.*,
            u.name as user_name,
            u.email as user_email,
            d.brand,
            d.model
          FROM device_access_logs dal
          LEFT JOIN users u ON dal.user_id = u.id
          LEFT JOIN devices d ON dal.device_id = d.id
          WHERE dal.device_id = ?
        `;
        
        const params = [deviceId];

        if (filters.accessType) {
          query += ' AND dal.access_type = ?';
          params.push(filters.accessType);
        }

        if (filters.result) {
          query += ' AND dal.result = ?';
          params.push(filters.result);
        }

        query += ' ORDER BY dal.created_at DESC LIMIT 100';

        const [rows] = await connection.execute(query, params);
        return rows;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error getting device access logs:', error);
      throw error;
    }
  }

  // Get user sessions
  async getUserSessions(userId, activeOnly = false) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        let query = `
          SELECT * FROM user_sessions 
          WHERE user_id = ?
        `;
        
        const params = [userId];

        if (activeOnly) {
          query += ' AND is_active = TRUE AND expires_at > NOW()';
        }

        query += ' ORDER BY last_activity DESC';

        const [rows] = await connection.execute(query, params);
        return rows;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error getting user sessions:', error);
      throw error;
    }
  }

  // Clean up old audit logs (for maintenance)
  async cleanupOldLogs(daysToKeep = 365) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        // Clean up old audit logs
        const [auditResult] = await connection.execute(
          'DELETE FROM audit_logs WHERE created_at < ?',
          [cutoffDate]
        );

        // Clean up old device access logs
        const [deviceResult] = await connection.execute(
          'DELETE FROM device_access_logs WHERE created_at < ?',
          [cutoffDate]
        );

        // Clean up expired sessions
        const [sessionResult] = await connection.execute(
          'DELETE FROM user_sessions WHERE expires_at < NOW() OR (is_active = FALSE AND last_activity < ?)',
          [cutoffDate]
        );

        console.log(`Cleanup completed: ${auditResult.affectedRows} audit logs, ${deviceResult.affectedRows} device access logs, ${sessionResult.affectedRows} sessions removed`);
        
        return {
          auditLogs: auditResult.affectedRows,
          deviceAccessLogs: deviceResult.affectedRows,
          sessions: sessionResult.affectedRows
        };
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error cleaning up old logs:', error);
      throw error;
    }
  }

  // Get audit statistics
  async getAuditStatistics(dateFrom, dateTo) {
    try {
      const connection = await this.pool.getConnection();
      
      try {
        const [stats] = await connection.execute(`
          SELECT 
            COUNT(*) as total_activities,
            COUNT(DISTINCT user_id) as unique_users,
            COUNT(DISTINCT ip_address) as unique_ips,
            COUNT(DISTINCT mac_address) as unique_macs,
            action,
            COUNT(*) as action_count
          FROM audit_logs 
          WHERE created_at BETWEEN ? AND ?
          GROUP BY action
          ORDER BY action_count DESC
        `, [dateFrom, dateTo]);

        return stats;
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error getting audit statistics:', error);
      throw error;
    }
  }
}

module.exports = new AuditService();