// Ownership Transfer Service - Secure device ownership transfers
const Database = require('../config');
const { escapeHtml } = require('../utils/escape-html');
const crypto = require('crypto');
const OTPService = require('./OTPService');
const NotificationService = require('./NotificationService');
const EmailTemplate = require('./EmailTemplate');
const { getDisplayName, nameSelectColumns } = require('../utils/user-helpers');

class OwnershipTransferService {
  constructor() {
    this.TRANSFER_EXPIRY_HOURS = 48;
    this.OTP_EXPIRY_MINUTES = 15;
    this.MAX_OTP_ATTEMPTS = 5;
    this.TRANSFER_CODE_LENGTH = 12;
  }

  // Initiate ownership transfer
  async initiateTransfer(transferData) {
    try {
      const {
        deviceId,
        fromUserId,
        salePrice,
        transferReason,
        buyerEmail,
        agreementTerms,
        transferLocation
      } = transferData;

      // Validate device ownership
      const device = await this.validateDeviceOwnership(deviceId, fromUserId);
      if (!device.valid) {
        return {
          success: false,
          error: device.error
        };
      }

      // Check if device is transferable
      const transferEligibility = await this.checkTransferEligibility(deviceId);
      if (!transferEligibility.eligible) {
        return {
          success: false,
          error: transferEligibility.reason
        };
      }

      // Generate unique transfer code
      const transferCode = this.generateTransferCode();
      
      // Calculate expiry time
      const expiresAt = new Date(Date.now() + this.TRANSFER_EXPIRY_HOURS * 60 * 60 * 1000);

      // Create transfer record
      const transferId = Database.generateUUID();
      const transfer = {
        id: transferId,
        device_id: deviceId,
        from_user_id: fromUserId,
        transfer_code: transferCode,
        status: 'initiated',
        sale_price: salePrice || null,
        transfer_reason: transferReason || 'Device sale',
        buyer_email: buyerEmail || null,
        agreement_terms: agreementTerms ? JSON.stringify(agreementTerms) : null,
        transfer_location: transferLocation ? JSON.stringify(transferLocation) : null,
        expires_at: expiresAt,
        created_at: new Date(),
        updated_at: new Date()
      };

      await Database.insert('ownership_transfers', transfer);

      // Set device status to pending_transfer so it cannot be re-initiated until resolved
      await Database.update(
        'devices',
        { status: 'pending_transfer', updated_at: new Date() },
        'id = ?',
        [deviceId]
      );

      // Send OTP to seller for verification
      const otpResult = await this.sendTransferOTP(fromUserId, transferId);
      if (!otpResult.success) {
        // Cleanup transfer record
        await Database.query('DELETE FROM ownership_transfers WHERE id = ?', [transferId]);
        return {
          success: false,
          error: 'Failed to send verification code'
        };
      }

      // Log transfer initiation
      await Database.logAudit(
        fromUserId,
        'TRANSFER_INITIATED',
        'ownership_transfers',
        transferId,
        null,
        { device_id: deviceId, transfer_code: transferCode },
        null
      );

      return {
        success: true,
        transferId,
        transferCode,
        expiresAt,
        message: 'Transfer initiated. Please check your email for verification code.'
      };

    } catch (error) {
      console.error('Transfer initiation error:', error);
      throw error;
    }
  }

  // Send OTP for transfer verification
  async sendTransferOTP(userId, transferId) {
    try {
      // Generate OTP
      const otpCode = this.generateOTP();
      const otpExpiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);

      // Update transfer with OTP
      await Database.update(
        'ownership_transfers',
        {
          otp_code: otpCode,
          otp_expires_at: otpExpiresAt,
          otp_attempts: 0,
          updated_at: new Date()
        },
        'id = ?',
        [transferId]
      );

      // Get user and device details
      const transferDetails = await Database.query(`
        SELECT 
          ot.*,
          u.name as seller_name,
          u.first_name as seller_first_name,
          u.middle_name as seller_middle_name,
          u.last_name as seller_last_name,
          u.email as seller_email,
          d.brand,
          d.model,
          d.imei,
          d.serial
        FROM ownership_transfers ot
        JOIN users u ON ot.from_user_id = u.id
        JOIN devices d ON ot.device_id = d.id
        WHERE ot.id = ?
      `, [transferId]);

      if (transferDetails.length === 0) {
        return { success: false, error: 'Transfer not found' };
      }

      const transfer = transferDetails[0];
      transfer.seller_display_name = getDisplayName({
        name: transfer.seller_name,
        first_name: transfer.seller_first_name,
        middle_name: transfer.seller_middle_name,
        last_name: transfer.seller_last_name
      });

      // Send OTP email
      await NotificationService.sendEmailDirect(
        transfer.seller_email,
        'Device Transfer Verification - Prove Ownership',
        EmailTemplate.wrapContent('Transfer Initiated', this.generateTransferOTPEmail(transfer, otpCode))
      );

      return { success: true };

    } catch (error) {
      console.error('Transfer OTP error:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify transfer OTP
  async verifyTransferOTP(transferId, otpCode, callerId = null) {
    try {
      // Get transfer details
      const transfer = await Database.selectOne(
        'ownership_transfers',
        '*',
        'id = ?',
        [transferId]
      );

      if (!transfer) {
        return {
          success: false,
          error: 'Transfer not found'
        };
      }

      // Check transfer status
      if (transfer.status !== 'initiated') {
        return {
          success: false,
          error: 'Transfer is not in initiated state'
        };
      }

      // Check if transfer expired
      if (new Date() > new Date(transfer.expires_at)) {
        await this.expireTransfer(transferId);
        return {
          success: false,
          error: 'Transfer has expired'
        };
      }

      if (callerId && transfer.from_user_id !== callerId) {
        return { success: false, error: 'Transfer not found' };
      }

      if ((transfer.otp_attempts || 0) >= this.MAX_OTP_ATTEMPTS) {
        return { success: false, error: 'Too many wrong codes. Request a new code.' };
      }

      // Check OTP
      if (!transfer.otp_code || String(transfer.otp_code) !== String(otpCode)) {
        await Database.query('UPDATE ownership_transfers SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = ?', [transferId]).catch(() => {});
        return {
          success: false,
          error: 'Invalid verification code'
        };
      }

      // Check OTP expiry
      if (transfer.otp_expires_at && new Date() > new Date(transfer.otp_expires_at)) {
        return {
          success: false,
          error: 'Verification code has expired'
        };
      }

      // Update transfer status
      await Database.update(
        'ownership_transfers',
        {
          status: 'otp_verified',
          updated_at: new Date()
        },
        'id = ?',
        [transferId]
      );

      // Activate transfer
      await this.activateTransfer(transferId);

      return {
        success: true,
        message: 'Transfer verified and activated'
      };

    } catch (error) {
      console.error('OTP verification error:', error);
      throw error;
    }
  }

  // Activate transfer (make it available for claiming)
  async activateTransfer(transferId) {
    try {
      // Update status to active
      await Database.update(
        'ownership_transfers',
        {
          status: 'active',
          updated_at: new Date()
        },
        'id = ?',
        [transferId]
      );

      // Get transfer details for notification
      const transferDetails = await Database.query(`
        SELECT 
          ot.*,
          u.name as seller_name,
          u.first_name as seller_first_name,
          u.middle_name as seller_middle_name,
          u.last_name as seller_last_name,
          u.email as seller_email,
          d.brand,
          d.model,
          d.imei,
          d.serial
        FROM ownership_transfers ot
        JOIN users u ON ot.from_user_id = u.id
        JOIN devices d ON ot.device_id = d.id
        WHERE ot.id = ?
      `, [transferId]);

      if (transferDetails.length > 0) {
        const transfer = transferDetails[0];
        transfer.seller_display_name = getDisplayName({
          name: transfer.seller_name,
          first_name: transfer.seller_first_name,
          middle_name: transfer.seller_middle_name,
          last_name: transfer.seller_last_name
        });

        // Send activation email to seller
        await NotificationService.sendEmailDirect(
          transfer.seller_email,
          'Device Transfer Activated - Prove Ownership',
          EmailTemplate.wrapContent('Transfer Verified', this.generateTransferActivationEmail(transfer))
        );

        // Send notification to buyer if email provided
        if (transfer.buyer_email) {
          await NotificationService.sendEmailDirect(
            transfer.buyer_email,
            'Device Available for Transfer - Prove Ownership',
            EmailTemplate.wrapContent('Transfer Request', this.generateBuyerNotificationEmail(transfer))
          );
        }
      }

      // Log activation
      await Database.logAudit(
        null,
        'TRANSFER_ACTIVATED',
        'ownership_transfers',
        transferId,
        { status: 'otp_verified' },
        { status: 'active' },
        null
      );

    } catch (error) {
      console.error('Transfer activation error:', error);
      throw error;
    }
  }

  // Complete transfer (buyer claims device)
  async completeTransfer(transferCode, buyerUserId, buyerOtpCode) {
    try {
      // Find a transfer that is waiting for the buyer (step 1) or for the
      // buyer's code (step 2)
      const transfer = await Database.selectOne(
        'ownership_transfers',
        '*',
        'transfer_code = ? AND status IN (?, ?)',
        [transferCode, 'active', 'awaiting_buyer_otp']
      );

      if (!transfer) {
        return {
          success: false,
          error: 'Invalid transfer code or transfer not available'
        };
      }

      if (transfer.from_user_id === buyerUserId) {
        return { success: false, error: 'You cannot transfer a device to yourself' };
      }

      // If the seller named a buyer, only that person can claim it
      const buyer = await Database.selectOne('users', `${nameSelectColumns()}, email`, 'id = ?', [buyerUserId]);
      if (!buyer) {
        return { success: false, error: 'Account not found' };
      }
      if (transfer.buyer_email && String(transfer.buyer_email).toLowerCase().trim() !== String(buyer.email || '').toLowerCase().trim()) {
        return { success: false, error: 'This transfer was sent to a different email address' };
      }

      // Check if transfer expired
      if (new Date() > new Date(transfer.expires_at)) {
        await this.expireTransfer(transfer.id);
        return {
          success: false,
          error: 'Transfer has expired'
        };
      }

      // Step 1 (or a new request for a code): send the buyer a code
      if (!buyerOtpCode) {
        if (transfer.status === 'awaiting_buyer_otp' && transfer.buyer_otp_user_id && transfer.buyer_otp_user_id !== buyerUserId) {
          return { success: false, error: 'Another account is already completing this transfer' };
        }
        const otpCode = this.generateOTP();
        const otpExpiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);

        await Database.update(
          'ownership_transfers',
          {
            buyer_otp_code: otpCode,
            buyer_otp_expires_at: otpExpiresAt,
            buyer_otp_user_id: buyerUserId,
            buyer_otp_attempts: 0,
            status: 'awaiting_buyer_otp',
            updated_at: new Date()
          },
          'id = ?',
          [transfer.id]
        );

        // Send OTP to buyer (do not fail transfer on email errors)
        try {
          await NotificationService.sendEmailDirect(
            buyer.email,
            'Verify Ownership Receipt - Prove Ownership',
            EmailTemplate.wrapContent('Confirm you are receiving this device', `
              <p>Hello ${escapeHtml(getDisplayName(buyer))},</p>
              <p>Use this code to confirm you are receiving the device:</p>
              <div style="background: #F0FDF4; padding: 24px; text-align: center; margin: 20px 0; border: 2px solid #16A34A; border-radius: 10px;">
                <div style="color: #15803D; font-size: 40px; margin: 0; letter-spacing: 10px; font-family: monospace; font-weight: 700;">${otpCode}</div>
                <p style="margin: 12px 0 0 0; color: #4B5563; font-size: 14px;">This code expires in ${this.OTP_EXPIRY_MINUTES} minutes</p>
              </div>
              <p style="color:#6B7280;font-size:14px;">If you are not expecting a device, ignore this email.</p>
            `)
          );
        } catch (emailErr) {
          console.error('Buyer OTP email send error:', emailErr);
        }

        return {
          success: true,
          requiresBuyerOtp: true,
          transferId: transfer.id,
          message: 'Verification code sent to your email'
        };
      }

      // Step 2: check the buyer's code
      if (transfer.status !== 'awaiting_buyer_otp' || transfer.buyer_otp_user_id !== buyerUserId) {
        return { success: false, error: 'Request a verification code first' };
      }

      if ((transfer.buyer_otp_attempts || 0) >= this.MAX_OTP_ATTEMPTS) {
        return { success: false, error: 'Too many wrong codes. Request a new code.' };
      }

      if (String(transfer.buyer_otp_code) !== String(buyerOtpCode)) {
        await Database.query('UPDATE ownership_transfers SET buyer_otp_attempts = COALESCE(buyer_otp_attempts, 0) + 1 WHERE id = ?', [transfer.id]).catch(() => {});
        return {
          success: false,
          error: 'Invalid buyer verification code'
        };
      }

      if (transfer.buyer_otp_expires_at && new Date() > new Date(transfer.buyer_otp_expires_at)) {
        return {
          success: false,
          error: 'Buyer verification code has expired'
        };
      }

      // Get device details
      const device = await Database.selectOne(
        'devices',
        '*',
        'id = ?',
        [transfer.device_id]
      );

      if (!device) {
        return {
          success: false,
          error: 'Device not found'
        };
      }

      if (device.user_id !== transfer.from_user_id) {
        return { success: false, error: 'The seller no longer owns this device' };
      }
      if (['stolen', 'lost'].includes(device.status)) {
        return { success: false, error: 'This device has been reported stolen or lost and cannot be transferred' };
      }
      if (device.ownership_level === 'disputed') {
        return { success: false, error: 'This item has an open ownership claim and cannot be transferred right now' };
      }

      // Claim the transfer and move ownership in one transaction
      const moved = await Database.transaction(async (conn) => {
        const [claim] = await conn.execute(
          "UPDATE ownership_transfers SET to_user_id = ?, status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'awaiting_buyer_otp'",
          [buyerUserId, transfer.id]
        );
        if (claim.affectedRows !== 1) return false;
        await conn.execute(
          "UPDATE devices SET user_id = ?, status = 'verified', updated_at = NOW() WHERE id = ? AND user_id = ?",
          [buyerUserId, transfer.device_id, transfer.from_user_id]
        );
        return true;
      });
      if (!moved) {
        return { success: false, error: 'This transfer has already been completed' };
      }
      // The buyer stays a verified owner only if the seller was one
      await require('./OwnershipProofService').carryOverLevel(transfer.device_id, device.ownership_level);

      // Get user details for notifications
      const seller = await Database.selectOne('users', `${nameSelectColumns()}, email`, 'id = ?', [transfer.from_user_id]);

      // Send completion notifications (do not fail transfer if email sending errors occur)
      try {
        await NotificationService.sendEmailDirect(
          seller.email,
          'Device Transfer Completed - Prove Ownership',
          EmailTemplate.wrapContent('Transfer Update', this.generateTransferCompletionEmail(transfer, device, seller, buyer, 'seller'))
        );
      } catch (emailErr) {
        console.error('Transfer completion seller email send error:', emailErr);
      }
      try {
        await NotificationService.sendEmailDirect(
          buyer.email,
          'Device Ownership Transferred - Prove Ownership',
          EmailTemplate.wrapContent('Transfer Update', this.generateTransferCompletionEmail(transfer, device, seller, buyer, 'buyer'))
        );
      } catch (emailErr) {
        console.error('Transfer completion buyer email send error:', emailErr);
      }

      // Log completion
      await Database.logAudit(
        buyerUserId,
        'TRANSFER_COMPLETED',
        'ownership_transfers',
        transfer.id,
        { status: 'active', to_user_id: null },
        { status: 'completed', to_user_id: buyerUserId },
        null
      );

      return {
        success: true,
        device: {
          id: device.id,
          brand: device.brand,
          model: device.model,
          category: device.category
        },
        message: 'Device ownership transferred successfully'
      };

    } catch (error) {
      console.error('Transfer completion error:', error);
      throw error;
    }
  }

  // Expire transfer
  async expireTransfer(transferId) {
    try {
      const t = await Database.selectOne('ownership_transfers', 'device_id', 'id = ?', [transferId]);
      await Database.update(
        'ownership_transfers',
        {
          status: 'expired',
          updated_at: new Date()
        },
        'id = ?',
        [transferId]
      );
      // Give the device back to its normal state so the owner can try again
      if (t) {
        await Database.query(
          "UPDATE devices SET status = 'verified', updated_at = NOW() WHERE id = ? AND status = 'pending_transfer'",
          [t.device_id]
        );
      }

      // Log expiration
      await Database.logAudit(
        null,
        'TRANSFER_EXPIRED',
        'ownership_transfers',
        transferId,
        null,
        { status: 'expired' },
        null
      );

    } catch (error) {
      console.error('Transfer expiration error:', error);
    }
  }

  // Cancel transfer
  async cancelTransfer(transferId, userId) {
    try {
      // Get transfer details
      const transfer = await Database.selectOne(
        'ownership_transfers',
        '*',
        'id = ? AND from_user_id = ?',
        [transferId, userId]
      );

      if (!transfer) {
        return {
          success: false,
          error: 'Transfer not found or unauthorized'
        };
      }

      if (transfer.status === 'completed') {
        return {
          success: false,
          error: 'Cannot cancel completed transfer'
        };
      }

      // Update status
      await Database.update(
        'ownership_transfers',
        {
          status: 'cancelled',
          updated_at: new Date()
        },
        'id = ?',
        [transferId]
      );

      // Reset device status back to verified for the seller
      await Database.update(
        'devices',
        { status: 'verified', updated_at: new Date() },
        'id = ?',
        [transfer.device_id]
      );

      // Log cancellation
      await Database.logAudit(
        userId,
        'TRANSFER_CANCELLED',
        'ownership_transfers',
        transferId,
        { status: transfer.status },
        { status: 'cancelled' },
        null
      );

      return {
        success: true,
        message: 'Transfer cancelled successfully'
      };

    } catch (error) {
      console.error('Transfer cancellation error:', error);
      throw error;
    }
  }

  // Reject transfer (buyer declines the transfer)
  async rejectTransfer(transferCode, buyerUserId, rejectionReason) {
    try {
      // Find transfer by code that is available for buyer action
      const transfer = await Database.selectOne(
        'ownership_transfers',
        '*',
        'transfer_code = ? AND status IN (?, ?)',
        [transferCode, 'active', 'awaiting_buyer_otp']
      );

      if (!transfer) {
        return { success: false, error: 'Transfer not found or not active' };
      }

      // Check expiry
      if (new Date() > new Date(transfer.expires_at)) {
        await this.expireTransfer(transfer.id);
        return { success: false, error: 'Transfer has expired' };
      }
      // Relax restriction: allow any authenticated user with the valid transfer code
      // to reject the transfer, even if buyer_email was specified.
      // This reduces friction for recipients using a different account/email.

      // Update status to rejected
      await Database.update(
        'ownership_transfers',
        {
          status: 'rejected',
          updated_at: new Date()
        },
        'id = ?',
        [transfer.id]
      );

      // Reset device status to verified, it returns to seller
      await Database.update(
        'devices',
        { status: 'verified', updated_at: new Date() },
        'id = ?',
        [transfer.device_id]
      );

      // Notify seller and buyer (if present)
      const [seller, buyer, device] = await Promise.all([
        Database.selectOne('users', `${nameSelectColumns()}, email`, 'id = ?', [transfer.from_user_id]),
        transfer.buyer_email ? Database.selectOne('users', `${nameSelectColumns()}, email`, 'id = ?', [buyerUserId]) : Promise.resolve(null),
        Database.selectOne('devices', 'brand, model, category, imei, serial', 'id = ?', [transfer.device_id])
      ]);

      const subject = 'Device Transfer Rejected - Prove Ownership';
      const bodySeller = `The transfer for device ${device.brand} ${device.model} (${device.category}) with code ${transfer.transfer_code} was rejected${buyer ? ` by ${getDisplayName(buyer)}` : ''}. Reason: ${rejectionReason || 'No reason provided.'}`;
      const bodyBuyer = `You have rejected the transfer for device ${device.brand} ${device.model} (${device.category}). Code: ${transfer.transfer_code}.`;

      // Send notifications but do not fail rejection if email sending errors occur
      try {
        await NotificationService.sendEmailDirect(seller.email, subject, EmailTemplate.wrapContent('Sale Completed', bodySeller));
      } catch (emailErr) {
        console.error('Reject transfer seller email send error:', emailErr);
      }
      if (buyer && buyer.email) {
        try {
          await NotificationService.sendEmailDirect(buyer.email, subject, EmailTemplate.wrapContent('Sale Completed', bodyBuyer));
        } catch (emailErr) {
          console.error('Reject transfer buyer email send error:', emailErr);
        }
      }

      // Log rejection
      await Database.logAudit(
        buyerUserId,
        'TRANSFER_REJECTED',
        'ownership_transfers',
        transfer.id,
        { status: transfer.status },
        { status: 'rejected' },
        { reason: rejectionReason || null }
      );

      return { success: true, message: 'Transfer rejected successfully' };

    } catch (error) {
      console.error('Transfer rejection error:', error);
      throw error;
    }
  }

  // Validate device ownership
  async validateDeviceOwnership(deviceId, userId) {
    try {
      const device = await Database.selectOne(
        'devices',
        'id, user_id, status, brand, model',
        'id = ?',
        [deviceId]
      );

      if (!device) {
        return { valid: false, error: 'Device not found' };
      }

      if (device.user_id !== userId) {
        return { valid: false, error: 'You are not the owner of this device' };
      }

      return { valid: true, device };

    } catch (error) {
      console.error('Ownership validation error:', error);
      return { valid: false, error: 'Validation failed' };
    }
  }

  // Check transfer eligibility
  async checkTransferEligibility(deviceId) {
    try {
      const device = await Database.selectOne(
        'devices',
        'status, ownership_level',
        'id = ?',
        [deviceId]
      );

      if (!device) {
        return { eligible: false, reason: 'Device not found' };
      }

      if (device.status === 'stolen' || device.status === 'lost') {
        return { eligible: false, reason: 'Cannot transfer stolen or lost devices' };
      }

      if (device.ownership_level === 'disputed') {
        return { eligible: false, reason: 'This item has an open ownership claim. It can be transferred once our team resolves it.' };
      }

      if (device.status !== 'verified') {
        return { eligible: false, reason: 'Device must be verified before transfer' };
      }

      // Check for pending transfers
      const pendingTransfer = await Database.selectOne(
        'ownership_transfers',
        'id',
        'device_id = ? AND status IN (?, ?, ?)',
        [deviceId, 'initiated', 'otp_verified', 'active']
      );

      if (pendingTransfer) {
        return { eligible: false, reason: 'Device has a pending transfer' };
      }

      return { eligible: true };

    } catch (error) {
      console.error('Transfer eligibility error:', error);
      return { eligible: false, reason: 'Eligibility check failed' };
    }
  }

  // Get user transfers
  async getUserTransfers(userId, type = 'all', page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      // Fetch user email to include transfers targeted to this user via buyer_email
      const user = await Database.selectOne('users', 'email', 'id = ?', [userId]);

      let whereClause = '';
      let params = [];

      // Build filters to ensure buyers see active transfers sent to their email
      const hasEmail = !!(user && user.email);
      const emailMatchClause = hasEmail ? 'LOWER(ot.buyer_email) = LOWER(?)' : null;
      // When matching by buyer_email, include transfers that were targeted to the user
      // and later cancelled (so the buyer can see them in history).
      const buyerEmailStatusesReceived = "('active','awaiting_buyer_otp','cancelled','expired','rejected')";
      const buyerEmailStatusesAll = "('active','awaiting_buyer_otp','cancelled','expired','rejected')";

      switch (type) {
        case 'sent':
          whereClause = 'ot.from_user_id = ?';
          params = [userId];
          break;
        case 'received':
          if (emailMatchClause) {
            // Include completed/rejected transfers where to_user_id matches,
            // and also active/awaiting/cancelled transfers that were targeted to the user's email.
            whereClause = `(ot.to_user_id = ? OR (${emailMatchClause} AND ot.status IN ${buyerEmailStatusesReceived}))`;
            params = [userId, user.email];
          } else {
            whereClause = 'ot.to_user_id = ?';
            params = [userId];
          }
          break;
        default:
          if (emailMatchClause) {
            // For 'all', include any transfers involving the user by id,
            // plus active/awaiting/cancelled ones targeted to their email.
            whereClause = '(ot.from_user_id = ? OR ot.to_user_id = ? OR (' + emailMatchClause + ' AND ot.status IN ' + buyerEmailStatusesAll + '))';
            params = [userId, userId, user.email];
          } else {
            whereClause = 'ot.from_user_id = ? OR ot.to_user_id = ?';
            params = [userId, userId];
          }
      }

      const [{ total }] = await Database.query(
        `SELECT COUNT(*) as total FROM ownership_transfers ot WHERE ${whereClause}`,
        params
      );

      const transfers = await Database.query(`
        SELECT 
          ot.*,
          d.brand,
          d.model,
          d.category,
          d.imei,
          d.serial,
          seller.name as seller_name,
          seller.first_name as seller_first_name,
          seller.middle_name as seller_middle_name,
          seller.last_name as seller_last_name,
          seller.email as seller_email,
          buyer.name as buyer_name,
          buyer.first_name as buyer_first_name,
          buyer.middle_name as buyer_middle_name,
          buyer.last_name as buyer_last_name,
          buyer.email as buyer_email
        FROM ownership_transfers ot
        JOIN devices d ON ot.device_id = d.id
        JOIN users seller ON ot.from_user_id = seller.id
        LEFT JOIN users buyer ON ot.to_user_id = buyer.id
        WHERE ${whereClause}
        ORDER BY ot.created_at DESC
        LIMIT ? OFFSET ?
      `, [...params, limit, offset]);

      return {
        transfers: transfers.map(transfer => {
          const isRecipientByUserId = transfer.to_user_id === userId;
          const isRecipientByEmail = hasEmail && transfer.buyer_email && transfer.buyer_email.toLowerCase() === user.email.toLowerCase();
          const isSenderByUserId = transfer.from_user_id === userId;
          const isActiveBuyerSide = transfer.status === 'active' || transfer.status === 'awaiting_buyer_otp';

          // Hide transfer_code for both buyer and seller while active/awaiting to enforce email-only delivery
          const shouldHideCode = isActiveBuyerSide && (isRecipientByUserId || isRecipientByEmail || isSenderByUserId);
          const sanitizedTransferCode = shouldHideCode ? null : transfer.transfer_code;

          return {
            ...transfer,
            transfer_code: sanitizedTransferCode,
            agreement_terms: this.safeJsonParse(transfer.agreement_terms),
            transfer_location: this.safeJsonParse(transfer.transfer_location)
          };
        }),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      };

    } catch (error) {
      console.error('Get transfers error:', error);
      throw error;
    }
  }

  // Cleanup expired transfers (background job)
  async cleanupExpiredTransfers() {
    try {
      const expiredTransfers = await Database.query(`
        SELECT id FROM ownership_transfers
        WHERE status IN ('initiated', 'otp_verified', 'active', 'awaiting_buyer_otp')
        AND expires_at < NOW()
      `);

      for (const transfer of expiredTransfers) {
        await this.expireTransfer(transfer.id);
      }

      return expiredTransfers.length;

    } catch (error) {
      console.error('Cleanup expired transfers error:', error);
      return 0;
    }
  }

  // Utility functions
  generateTransferCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < this.TRANSFER_CODE_LENGTH; i++) {
      result += chars.charAt(crypto.randomInt(0, chars.length));
    }
    return result;
  }

  generateOTP() {
    return crypto.randomInt(100000, 1000000).toString();
  }

  safeJsonParse(jsonString) {
    try {
      return jsonString ? JSON.parse(jsonString) : null;
    } catch (error) {
      return null;
    }
  }

  // Email templates
  generateTransferOTPEmail(transfer, otpCode) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #646cff; color: white; padding: 20px; text-align: center;">
          <h1>Device Transfer Verification</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Verify Your Device Transfer</h2>
          <p>Hello ${escapeHtml(transfer.seller_display_name)},</p>
          <p>You have initiated a transfer for your device:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${escapeHtml(transfer.brand)} ${escapeHtml(transfer.model)}</h3>
            <p><strong>Expires:</strong> ${new Date(transfer.expires_at).toLocaleString()}</p>
          </div>
          
          <p>To complete the transfer setup, please enter this verification code:</p>
          
          <div style="background: white; padding: 30px; text-align: center; margin: 20px 0; border: 3px solid #646cff; border-radius: 10px;">
            <h1 style="color: #646cff; font-size: 48px; margin: 0; letter-spacing: 10px; font-family: monospace;">${otpCode}</h1>
            <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">This code expires in ${this.OTP_EXPIRY_MINUTES} minutes</p>
          </div>
          
          <p><strong>Important:</strong> The buyer will receive the transfer code directly via email once you verify this OTP.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Prove Ownership Device Registry</p>
        </div>
      </div>
    `;
  }

  generateTransferActivationEmail(transfer) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
          <h1>✅ Transfer Activated</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Your Device Transfer is Ready</h2>
          <p>Hello ${escapeHtml(transfer.seller_display_name)},</p>
          <p>Your device transfer has been activated and is ready for the buyer:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${escapeHtml(transfer.brand)} ${escapeHtml(transfer.model)}</h3>
            <p><strong>Valid Until:</strong> ${new Date(transfer.expires_at).toLocaleString()}</p>
          </div>
          
          <p><strong>Next Steps:</strong></p>
          <ol>
            <li>The buyer has been notified and will receive the transfer code by email</li>
            <li>The buyer will use the code to claim ownership</li>
            <li>You'll receive confirmation when the transfer is complete</li>
          </ol>
          
          <p><strong>Security Note:</strong> Do not share any transfer codes. The system delivers codes directly to the intended buyer. The transfer will expire in ${this.TRANSFER_EXPIRY_HOURS} hours.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Prove Ownership Device Registry</p>
        </div>
      </div>
    `;
  }

  generateBuyerNotificationEmail(transfer) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #646cff; color: white; padding: 20px; text-align: center;">
          <h1>📱 Device Available for Transfer</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Device Ready for Ownership Transfer</h2>
          <p>Hello,</p>
          <p>A device has been prepared for transfer to you:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${escapeHtml(transfer.brand)} ${escapeHtml(transfer.model)}</h3>
            <p><strong>Seller:</strong> ${escapeHtml(transfer.seller_display_name)}</p>
            ${transfer.sale_price ? `<p><strong>Price:</strong> ₦${escapeHtml(Number(transfer.sale_price).toLocaleString('en-NG'))}</p>` : ''}
            <p><strong>Transfer Code:</strong> <span style="font-family: monospace; color: #646cff; letter-spacing: 0.08em;">${transfer.transfer_code}</span></p>
          </div>
          
          <p><strong>To claim ownership:</strong></p>
          <ol>
            <li>Log into your Prove Ownership account (or create one with this email address)</li>
            <li>Open <a href="${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/transfer?code=${encodeURIComponent(transfer.transfer_code)}">Receive a device</a>, or go to Transfers → Receive and enter the code above</li>
            <li>Enter the 6-digit code we email you to confirm</li>
          </ol>
          
          <p><strong>Important:</strong> The transfer code expires at ${new Date(transfer.expires_at).toLocaleString()}.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Prove Ownership Device Registry</p>
        </div>
      </div>
    `;
  }

  // Resend transfer code email to buyer
  async resendTransferCode(transferId, fromUserId) {
    try {
      const transfer = await Database.selectOne(
        'ownership_transfers',
        '*',
        'id = ?',
        [transferId]
      );

      if (!transfer) {
        return { success: false, error: 'Transfer not found' };
      }

      if (transfer.from_user_id !== fromUserId) {
        return { success: false, error: 'Unauthorized to resend code' };
      }

      if (!transfer.buyer_email) {
        return { success: false, error: 'No buyer email specified for this transfer' };
      }

      if (!['active', 'awaiting_buyer_otp'].includes(transfer.status)) {
        return { success: false, error: 'Transfer not activated yet' };
      }

      // Load details for email
      const details = await Database.query(`
        SELECT ot.*, u.name as seller_name, u.first_name as seller_first_name, u.middle_name as seller_middle_name, u.last_name as seller_last_name, u.email as seller_email, d.brand, d.model, d.imei, d.serial
        FROM ownership_transfers ot
        JOIN users u ON ot.from_user_id = u.id
        JOIN devices d ON ot.device_id = d.id
        WHERE ot.id = ?
      `, [transferId]);

      const t = details[0] || transfer;
      t.seller_display_name = getDisplayName({
        name: t.seller_name,
        first_name: t.seller_first_name,
        middle_name: t.seller_middle_name,
        last_name: t.seller_last_name
      });

      await NotificationService.sendEmailDirect(
        t.buyer_email,
        'Device Transfer Code (Resent) - Prove Ownership',
        EmailTemplate.wrapContent('Transfer Notification', this.generateBuyerNotificationEmail(t))
      );

      await Database.logAudit(
        fromUserId,
        'TRANSFER_CODE_RESENT',
        'ownership_transfers',
        transferId,
        null,
        null,
        null
      );

      return { success: true, message: 'Transfer code resent to buyer' };
    } catch (error) {
      console.error('Resend transfer code error:', error);
      throw error;
    }
  }

  // Resend seller transfer verification OTP email
  async resendSellerOTP(transferId, fromUserId) {
    try {
      const transfer = await Database.selectOne(
        'ownership_transfers',
        '*',
        'id = ?',
        [transferId]
      );

      if (!transfer) {
        return { success: false, error: 'Transfer not found' };
      }

      if (transfer.from_user_id !== fromUserId) {
        return { success: false, error: 'Unauthorized to resend code' };
      }

      if (transfer.status !== 'initiated') {
        return { success: false, error: 'Transfer not in initiated state' };
      }

      const otpResult = await this.sendTransferOTP(fromUserId, transferId);
      if (!otpResult.success) {
        return { success: false, error: otpResult.error || 'Failed to resend verification code' };
      }

      await Database.logAudit(
        fromUserId,
        'TRANSFER_OTP_RESENT',
        'ownership_transfers',
        transferId,
        null,
        null,
        null
      );

      return { success: true, message: 'Verification code resent to your email' };
    } catch (error) {
      console.error('Resend seller OTP error:', error);
      throw error;
    }
  }

  generateTransferCompletionEmail(transfer, device, seller, buyer, recipient) {
    const isSeller = recipient === 'seller';
    const otherParty = isSeller ? buyer : seller;
    const action = isSeller ? 'transferred to' : 'received from';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
          <h1>Transfer Complete</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Device Ownership ${isSeller ? 'Transferred' : 'Received'}</h2>
          <p>Hello ${isSeller ? getDisplayName(seller) : getDisplayName(buyer)},</p>
          <p>The device ownership transfer has been completed successfully:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${escapeHtml(device.brand)} ${escapeHtml(device.model)}</h3>
            <p><strong>Transfer Code:</strong> ${transfer.transfer_code}</p>
            <p><strong>${isSeller ? 'Buyer' : 'Seller'}:</strong> ${escapeHtml(getDisplayName(otherParty))} (${otherParty.email})</p>
            <p><strong>Completed:</strong> ${new Date().toLocaleString()}</p>
            ${transfer.sale_price ? `<p><strong>Sale Price:</strong> ₦${escapeHtml(Number(transfer.sale_price).toLocaleString('en-NG'))}</p>` : ''}
          </div>
          
          ${isSeller ? `
            <p><strong>Important:</strong> You are no longer the registered owner of this device. The new owner can now manage the device registration.</p>
          ` : `
            <p><strong>Congratulations!</strong> You are now the registered owner of this device. You can manage it through your Prove Ownership dashboard.</p>
          `}
          
          <p>This transfer has been recorded in our system for security and legal purposes.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Prove Ownership Device Registry</p>
        </div>
      </div>
    `;
  }
}

module.exports = new OwnershipTransferService();
