// Device Transfer Routes - Ownership Transfer System
const express = require("express");
const Database = require("../config");
const { authenticateToken } = require("../middleware/auth");
const NotificationService = require("../services/NotificationService");

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Generate OTP for transfer
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
}

// Initiate device transfer (legacy endpoint, renamed to avoid collision)
router.post("/initiate-legacy", async (req, res) => {
  try {
    const { device_id, to_user_email, transfer_reason } = req.body;
    const fromUserId = req.user.id;

    // Validate inputs
    if (!device_id || !to_user_email) {
      return res
        .status(400)
        .json({ error: "Device ID and recipient email are required" });
    }

    // Check if device exists and belongs to current user
    const device = await Database.selectOne(
      "devices",
      "*",
      "id = ? AND user_id = ?",
      [device_id, fromUserId]
    );

    if (!device) {
      return res
        .status(404)
        .json({ error: "Device not found or you do not own this device" });
    }

    // Check device status
    if (device.status === "stolen" || device.status === "lost") {
      return res.status(400).json({
        error: "Cannot transfer device that is reported as stolen or lost",
      });
    }

    if (device.status === "pending_transfer") {
      return res.status(400).json({
        error: "Device already has a pending transfer",
      });
    }

    // Find recipient user
    const toUser = await Database.selectOne("users", "*", "email = ?", [
      to_user_email,
    ]);
    if (!toUser) {
      return res.status(404).json({
        error:
          "Recipient user not found. They must have an account in the system.",
      });
    }

    if (toUser.id === fromUserId) {
      return res
        .status(400)
        .json({ error: "Cannot transfer device to yourself" });
    }

    // Check for existing pending transfer
    const existingTransfer = await Database.selectOne(
      "device_transfers",
      "*",
      'device_id = ? AND status = "pending"',
      [device_id]
    );

    if (existingTransfer) {
      return res.status(400).json({
        error: "Device already has a pending transfer request",
      });
    }

    // Generate transfer code (OTP)
    const transferCode = generateOTP();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create transfer request
    const transferId = Database.generateUUID();
    await Database.insert("device_transfers", {
      id: transferId,
      device_id: device_id,
      from_user_id: fromUserId,
      to_user_id: toUser.id,
      transfer_code: transferCode,
      status: "pending",
      expires_at: expiresAt,
      created_at: new Date(),
    });

    // Update device status
    await Database.update(
      "devices",
      {
        status: "pending_transfer",
        updated_at: new Date(),
      },
      "id = ?",
      [device_id]
    );

    // Send notification to recipient
    await NotificationService.queueNotification(
      toUser.id,
      "email",
      toUser.email,
      "Device Transfer Request",
      `
        <h2>Device Transfer Request</h2>
        <p>You have received a device transfer request from <strong>${
          req.user.name
        }</strong> (${req.user.email}).</p>
        <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
        <p><strong>IMEI:</strong> ${device.imei || "Not provided"}</p>
        <p><strong>Serial:</strong> ${device.serial || "Not provided"}</p>
        ${
          transfer_reason
            ? `<p><strong>Reason:</strong> ${transfer_reason}</p>`
            : ""
        }
        <p><strong>Transfer Code:</strong> <span style="font-size: 18px; font-weight: bold; color: #646cff;">${transferCode}</span></p>
        <p>This transfer code expires in 24 hours. Use it to accept or reject the transfer in your dashboard.</p>
        <p>If you did not expect this transfer, please contact the sender or our support team.</p>
      `,
      {
        transferId: transferId,
        transferCode: transferCode,
        deviceInfo: `${device.brand} ${device.model}`,
        type: "device_transfer_request",
      }
    );

    // Send SMS if phone number available
    if (toUser.phone) {
      await NotificationService.queueNotification(
        toUser.id,
        "sms",
        toUser.phone,
        null,
        `Check It: Device transfer request from ${req.user.name}. ${device.brand} ${device.model}. Code: ${transferCode}. Expires in 24h.`
      );
    }

    // Notify sender
    await NotificationService.queueNotification(
      fromUserId,
      "email",
      req.user.email,
      "Transfer Request Sent",
      `
        <h2>Transfer Request Sent</h2>
        <p>Your device transfer request has been sent to <strong>${toUser.name}</strong> (${toUser.email}).</p>
        <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
        <p><strong>Transfer Code:</strong> ${transferCode}</p>
        <p>The recipient has 24 hours to accept or reject the transfer.</p>
        <p>You will be notified once they respond.</p>
      `,
      {
        transferId: transferId,
        type: "transfer_request_sent",
      }
    );

    res.json({
      success: true,
      message: "Transfer request sent successfully",
      transfer_id: transferId,
      transfer_code: transferCode,
      expires_at: expiresAt,
      recipient: {
        name: toUser.name,
        email: toUser.email,
      },
    });
  } catch (error) {
    console.error("Transfer initiate error:", error);
    res.status(500).json({ error: "Failed to initiate device transfer" });
  }
});

// Accept device transfer (legacy endpoint, renamed to avoid collision)
router.post("/accept-legacy", async (req, res) => {
  try {
    const { transfer_code, proof_of_handover_url } = req.body;
    const userId = req.user.id;

    if (!transfer_code) {
      return res.status(400).json({ error: "Transfer code is required" });
    }

    // Find transfer request
    const transfer = await Database.selectOne(
      "device_transfers",
      "*",
      'transfer_code = ? AND to_user_id = ? AND status = "pending"',
      [transfer_code, userId]
    );

    if (!transfer) {
      return res.status(404).json({
        error: "Invalid transfer code or transfer not found",
      });
    }

    // Check if expired
    if (new Date() > new Date(transfer.expires_at)) {
      await Database.update(
        "device_transfers",
        {
          status: "expired",
          updated_at: new Date(),
        },
        "id = ?",
        [transfer.id]
      );

      return res.status(400).json({ error: "Transfer code has expired" });
    }

    // Get device and users info
    const device = await Database.selectOne("devices", "*", "id = ?", [
      transfer.device_id,
    ]);
    const fromUser = await Database.selectOne(
      "users",
      "name, email",
      "id = ?",
      [transfer.from_user_id]
    );

    if (!device || !fromUser) {
      return res.status(404).json({ error: "Device or user not found" });
    }

    // Perform transfer in transaction
    await Database.transaction(async (connection) => {
      // Update device ownership
      await connection.execute(
        'UPDATE devices SET user_id = ?, status = "verified", updated_at = NOW() WHERE id = ?',
        [userId, device.id]
      );

      // Update transfer status
      await connection.execute(
        'UPDATE device_transfers SET status = "accepted", accepted_at = NOW(), updated_at = NOW() WHERE id = ?',
        [transfer.id]
      );

      // Log audit trail
      await connection.execute(
        "INSERT INTO audit_logs (id, user_id, action, table_name, record_id, old_values, new_values, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())",
        [
          Database.generateUUID(),
          userId,
          "DEVICE_TRANSFER_ACCEPTED",
          "devices",
          device.id,
          JSON.stringify({ user_id: transfer.from_user_id }),
          JSON.stringify({ user_id: userId, proof_url: proof_of_handover_url }),
          req.ip,
        ]
      );
    });

    // Send notifications
    try {
      // Notify previous owner
      await NotificationService.queueNotification(
        transfer.from_user_id,
        "email",
        fromUser.email,
        "Device Transfer Completed",
        `
          <h2>Device Transfer Completed</h2>
          <p>Your device transfer has been accepted by <strong>${
            req.user.name
          }</strong>.</p>
          <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
          <p><strong>Transfer Code:</strong> ${transfer_code}</p>
          <p>The device ownership has been successfully transferred.</p>
          ${
            proof_of_handover_url
              ? `<p><strong>Handover Proof:</strong> <a href="${proof_of_handover_url}">View Document</a></p>`
              : ""
          }
          <p>Thank you for using Check It Device Registry.</p>
        `,
        {
          transferId: transfer.id,
          type: "transfer_completed",
        }
      );

      // Notify new owner
      await NotificationService.queueNotification(
        userId,
        "email",
        req.user.email,
        "Device Transfer Accepted",
        `
          <h2>Device Transfer Accepted</h2>
          <p>You have successfully accepted the device transfer from <strong>${fromUser.name}</strong>.</p>
          <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
          <p>The device is now registered under your account and is protected in our registry.</p>
          <p>You can view and manage this device in your dashboard.</p>
        `,
        {
          transferId: transfer.id,
          type: "transfer_accepted",
        }
      );
    } catch (notificationError) {
      console.error("Transfer notification error:", notificationError);
    }

    res.json({
      success: true,
      message: "Device transfer accepted successfully",
      device: {
        id: device.id,
        brand: device.brand,
        model: device.model,
        imei: device.imei,
        serial: device.serial,
      },
      previous_owner: fromUser.name,
    });
  } catch (error) {
    console.error("Transfer accept error:", error);
    res.status(500).json({ error: "Failed to accept device transfer" });
  }
});

// Reject device transfer (legacy endpoint, renamed to avoid collision)
router.post("/reject-legacy", async (req, res) => {
  try {
    const { transfer_code, rejection_reason } = req.body;
    const userId = req.user.id;

    if (!transfer_code) {
      return res.status(400).json({ error: "Transfer code is required" });
    }

    // Find transfer request
    const transfer = await Database.selectOne(
      "device_transfers",
      "*",
      'transfer_code = ? AND to_user_id = ? AND status = "pending"',
      [transfer_code, userId]
    );

    if (!transfer) {
      return res.status(404).json({
        error: "Invalid transfer code or transfer not found",
      });
    }

    // Get device and users info
    const device = await Database.selectOne("devices", "*", "id = ?", [
      transfer.device_id,
    ]);
    const fromUser = await Database.selectOne(
      "users",
      "name, email",
      "id = ?",
      [transfer.from_user_id]
    );

    // Update transfer status and device status
    await Database.update(
      "device_transfers",
      {
        status: "rejected",
        updated_at: new Date(),
      },
      "id = ?",
      [transfer.id]
    );

    await Database.update(
      "devices",
      {
        status:
          device.status === "pending_transfer" ? "verified" : device.status,
        updated_at: new Date(),
      },
      "id = ?",
      [device.id]
    );

    // Log audit trail
    await Database.logAudit(
      userId,
      "DEVICE_TRANSFER_REJECTED",
      "device_transfers",
      transfer.id,
      { status: "pending" },
      { status: "rejected", reason: rejection_reason },
      req.ip
    );

    // Notify original owner
    await NotificationService.queueNotification(
      transfer.from_user_id,
      "email",
      fromUser.email,
      "Device Transfer Rejected",
      `
        <h2>Device Transfer Rejected</h2>
        <p>Your device transfer request has been rejected by <strong>${
          req.user.name
        }</strong>.</p>
        <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
        <p><strong>Transfer Code:</strong> ${transfer_code}</p>
        ${
          rejection_reason
            ? `<p><strong>Reason:</strong> ${rejection_reason}</p>`
            : ""
        }
        <p>The device remains under your ownership. You can initiate a new transfer if needed.</p>
      `,
      {
        transferId: transfer.id,
        type: "transfer_rejected",
      }
    );

    res.json({
      success: true,
      message: "Device transfer rejected successfully",
    });
  } catch (error) {
    console.error("Transfer reject error:", error);
    res.status(500).json({ error: "Failed to reject device transfer" });
  }
});

// Get user's transfer requests (sent and received)
router.get("/requests", async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = "all", status } = req.query; // type: 'sent', 'received', 'all'

    let whereClause = "";
    let params = [];

    if (type === "sent") {
      whereClause = "dt.from_user_id = ?";
      params.push(userId);
    } else if (type === "received") {
      whereClause = "dt.to_user_id = ?";
      params.push(userId);
    } else {
      whereClause = "(dt.from_user_id = ? OR dt.to_user_id = ?)";
      params.push(userId, userId);
    }

    if (status) {
      whereClause += " AND dt.status = ?";
      params.push(status);
    }

    const transfers = await Database.query(
      `
      SELECT 
        dt.*,
        d.brand,
        d.model,
        d.imei,
        d.serial,
        d.color,
        from_user.name as from_user_name,
        from_user.email as from_user_email,
        to_user.name as to_user_name,
        to_user.email as to_user_email
      FROM device_transfers dt
      JOIN devices d ON dt.device_id = d.id
      JOIN users from_user ON dt.from_user_id = from_user.id
      JOIN users to_user ON dt.to_user_id = to_user.id
      WHERE ${whereClause}
      ORDER BY dt.created_at DESC
    `,
      params
    );

    res.json({
      transfers: transfers.map((transfer) => ({
        ...transfer,
        is_sender: transfer.from_user_id === userId,
        is_recipient: transfer.to_user_id === userId,
        can_accept:
          transfer.to_user_id === userId &&
          transfer.status === "pending" &&
          new Date() <= new Date(transfer.expires_at),
        can_reject:
          transfer.to_user_id === userId &&
          transfer.status === "pending" &&
          new Date() <= new Date(transfer.expires_at),
        is_expired:
          new Date() > new Date(transfer.expires_at) &&
          transfer.status === "pending",
      })),
    });
  } catch (error) {
    console.error("Transfer requests error:", error);
    res.status(500).json({ error: "Failed to load transfer requests" });
  }
});

// Cancel pending transfer (by sender only)
router.delete("/:transferId", async (req, res) => {
  try {
    const { transferId } = req.params;
    const userId = req.user.id;

    // Find transfer
    const transfer = await Database.selectOne(
      "device_transfers",
      "*",
      'id = ? AND from_user_id = ? AND status = "pending"',
      [transferId, userId]
    );

    if (!transfer) {
      return res.status(404).json({
        error: "Transfer not found or you cannot cancel this transfer",
      });
    }

    // Update transfer status
    await Database.update(
      "device_transfers",
      {
        status: "cancelled",
        updated_at: new Date(),
      },
      "id = ?",
      [transferId]
    );

    // Reset device status
    await Database.update(
      "devices",
      {
        status: "verified", // Assume it was verified before transfer
        updated_at: new Date(),
      },
      "id = ?",
      [transfer.device_id]
    );

    // Get recipient info for notification
    const toUser = await Database.selectOne("users", "name, email", "id = ?", [
      transfer.to_user_id,
    ]);
    const device = await Database.selectOne(
      "devices",
      "brand, model",
      "id = ?",
      [transfer.device_id]
    );

    // Notify recipient
    if (toUser) {
      await NotificationService.queueNotification(
        transfer.to_user_id,
        "email",
        toUser.email,
        "Device Transfer Cancelled",
        `
          <h2>Device Transfer Cancelled</h2>
          <p>The device transfer request from <strong>${req.user.name}</strong> has been cancelled.</p>
          <p><strong>Device:</strong> ${device.brand} ${device.model}</p>
          <p><strong>Transfer Code:</strong> ${transfer.transfer_code}</p>
          <p>This transfer is no longer valid.</p>
        `,
        {
          transferId: transferId,
          type: "transfer_cancelled",
        }
      );
    }

    res.json({
      success: true,
      message: "Transfer request cancelled successfully",
    });
  } catch (error) {
    console.error("Transfer cancel error:", error);
    res.status(500).json({ error: "Failed to cancel transfer request" });
  }
});

// Cleanup expired transfers (background job endpoint)
router.post("/cleanup-expired", async (req, res) => {
  try {
    // This should be called by a background job, but for now it's a manual endpoint

    // Find expired transfers
    const expiredTransfers = await Database.query(`
      SELECT dt.*, d.id as device_id
      FROM device_transfers dt
      JOIN devices d ON dt.device_id = d.id
      WHERE dt.status = 'pending' AND dt.expires_at < NOW()
    `);

    let cleaned = 0;
    for (const transfer of expiredTransfers) {
      // Update transfer status
      await Database.update(
        "device_transfers",
        {
          status: "expired",
          updated_at: new Date(),
        },
        "id = ?",
        [transfer.id]
      );

      // Reset device status
      await Database.update(
        "devices",
        {
          status: "verified",
          updated_at: new Date(),
        },
        "id = ?",
        [transfer.device_id]
      );

      cleaned++;
    }

    res.json({
      success: true,
      message: `Cleaned up ${cleaned} expired transfers`,
    });
  } catch (error) {
    console.error("Transfer cleanup error:", error);
    res.status(500).json({ error: "Failed to cleanup expired transfers" });
  }
});

module.exports = router;

// =====================
// Ownership history list
// =====================

// GET /api/device-transfer/history - List ownership transfers
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, start_date, end_date, category } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Base where clause
    let where = '1=1';
    const params = [];
    if (status) { where += ' AND ot.status = ?'; params.push(status); }
    if (start_date && end_date) { where += ' AND DATE(ot.created_at) BETWEEN ? AND ?'; params.push(start_date, end_date); }
    if (category) { where += ' AND d.category = ?'; params.push(category); }

    // Role-based filtering
    if (req.user.role === 'lea') {
      // Restrict to transfers where either party is in the LEA's region
      where += ' AND (COALESCE(seller.region, "") = ? OR COALESCE(buyer.region, "") = ?)';
      params.push(req.user.region, req.user.region);
    }

    const transfers = await Database.query(`
      SELECT 
        ot.id,
        ot.device_id,
        ot.from_user_id,
        ot.to_user_id,
        ot.status,
        ot.transfer_code,
        ot.created_at,
        ot.completed_at AS accepted_at,
        CASE WHEN ot.status = 'rejected' THEN ot.updated_at ELSE NULL END AS rejected_at,
        ot.expires_at,
        d.brand, d.model, d.imei, d.serial, d.category,
        seller.name AS from_user_name, seller.email AS from_user_email, seller.region AS from_region,
        buyer.name AS to_user_name, buyer.email AS to_user_email, buyer.region AS to_region
      FROM ownership_transfers ot
      LEFT JOIN devices d ON ot.device_id = d.id
      LEFT JOIN users seller ON ot.from_user_id = seller.id
      LEFT JOIN users buyer ON ot.to_user_id = buyer.id
      WHERE ${where}
      ORDER BY ot.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const totalRows = await Database.query(`
      SELECT COUNT(*) AS total
      FROM ownership_transfers ot
      LEFT JOIN devices d ON ot.device_id = d.id
      LEFT JOIN users seller ON ot.from_user_id = seller.id
      LEFT JOIN users buyer ON ot.to_user_id = buyer.id
      WHERE ${where}
    `, params);

    res.json({
      transfers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalRows[0]?.total || 0,
        pages: Math.ceil((totalRows[0]?.total || 0) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Transfer history error:', error);
    res.status(500).json({ error: 'Failed to load transfer history' });
  }
});
// POST /api/device-transfer/initiate - Initiate device ownership transfer
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const {
      deviceId,
      salePrice,
      transferReason,
      buyerEmail,
      agreementTerms,
      transferLocation
    } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const OwnershipTransferService = require('../services/OwnershipTransferService');
    
    const result = await OwnershipTransferService.initiateTransfer({
      deviceId,
      fromUserId: req.user.id,
      salePrice,
      transferReason,
      buyerEmail,
      agreementTerms,
      transferLocation
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result);

  } catch (error) {
    console.error('Transfer initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate transfer' });
  }
});

// POST /api/device-transfer/verify-otp - Verify transfer OTP
router.post('/verify-otp', authenticateToken, async (req, res) => {
  try {
    const { transferId, otpCode } = req.body;

    if (!transferId || !otpCode) {
      return res.status(400).json({ error: 'Transfer ID and OTP code are required' });
    }

    const OwnershipTransferService = require('../services/OwnershipTransferService');
    
    const result = await OwnershipTransferService.verifyTransferOTP(transferId, otpCode);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);

  } catch (error) {
    console.error('Transfer OTP verification error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// POST /api/device-transfer/complete - Complete transfer with code
router.post('/complete', authenticateToken, async (req, res) => {
  try {
    const { transferCode, otpCode } = req.body;

    if (!transferCode) {
      return res.status(400).json({ error: 'Transfer code is required' });
    }

    const OwnershipTransferService = require('../services/OwnershipTransferService');
    
    const result = await OwnershipTransferService.completeTransfer(transferCode, req.user.id, otpCode);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);

  } catch (error) {
    console.error('Transfer completion error:', error);
    res.status(500).json({ error: 'Failed to complete transfer' });
  }
});

// Reject ownership transfer (unified route)
router.post('/reject', authenticateToken, async (req, res) => {
  try {
    const { transfer_code, rejection_reason } = req.body;
    const userId = req.user.id;

    if (!transfer_code) {
      return res.status(400).json({ error: 'Transfer code is required' });
    }

    // Ensure service is available for the unified transfer flow
    const OwnershipTransferService = require('../services/OwnershipTransferService');
    const result = await OwnershipTransferService.rejectTransfer(transfer_code, userId, rejection_reason);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to reject transfer' });
    }

    res.json(result);
  } catch (error) {
    console.error('Unified reject error:', error);
    res.status(500).json({ error: 'Failed to reject transfer' });
  }
});

// POST /api/device-transfer/cancel - Cancel transfer
router.post('/cancel', authenticateToken, async (req, res) => {
  try {
    const { transferId } = req.body;

    if (!transferId) {
      return res.status(400).json({ error: 'Transfer ID is required' });
    }

    const OwnershipTransferService = require('../services/OwnershipTransferService');
    
    const result = await OwnershipTransferService.cancelTransfer(transferId, req.user.id);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);

  } catch (error) {
    console.error('Transfer cancellation error:', error);
    res.status(500).json({ error: 'Failed to cancel transfer' });
  }
});

// POST /api/device-transfer/resend-code - Resend transfer code to buyer (seller only)
router.post('/resend-code', authenticateToken, async (req, res) => {
  try {
    const { transferId } = req.body;

    if (!transferId) {
      return res.status(400).json({ error: 'Transfer ID is required' });
    }

    const OwnershipTransferService = require('../services/OwnershipTransferService');

    const result = await OwnershipTransferService.resendTransferCode(transferId, req.user.id);

    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to resend transfer code' });
    }

    res.json(result);

  } catch (error) {
    console.error('Resend transfer code error:', error);
    res.status(500).json({ error: 'Failed to resend transfer code' });
  }
});

// GET /api/device-transfer/my-transfers - Get user's transfers
router.get('/my-transfers', authenticateToken, async (req, res) => {
  try {
    const { type = 'all' } = req.query;

    const OwnershipTransferService = require('../services/OwnershipTransferService');
    
    const transfers = await OwnershipTransferService.getUserTransfers(req.user.id, type);

    res.json({ transfers });

  } catch (error) {
    console.error('Get transfers error:', error);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});