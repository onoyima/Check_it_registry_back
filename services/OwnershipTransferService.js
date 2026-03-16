// Ownership Transfer Service - Secure device ownership transfers
const Database = require('../config');
const OTPService = require('./OTPService');
const NotificationService = require('./NotificationService');

class OwnershipTransferService {
  constructor() {
    this.TRANSFER_EXPIRY_HOURS = 48;
    this.OTP_EXPIRY_MINUTES = 15;
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

      // Send OTP email
      await NotificationService.sendEmailDirect(
        transfer.seller_email,
        'Device Transfer Verification - Check It Registry',
        this.generateTransferOTPEmail(transfer, otpCode)
      );

      return { success: true };

    } catch (error) {
      console.error('Transfer OTP error:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify transfer OTP
  async verifyTransferOTP(transferId, otpCode) {
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

      // Check OTP
      if (!transfer.otp_code || transfer.otp_code !== otpCode) {
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

        // Send activation email to seller
        await NotificationService.sendEmailDirect(
          transfer.seller_email,
          'Device Transfer Activated - Check It Registry',
          this.generateTransferActivationEmail(transfer)
        );

        // Send notification to buyer if email provided
        if (transfer.buyer_email) {
          await NotificationService.sendEmailDirect(
            transfer.buyer_email,
            'Device Available for Transfer - Check It Registry',
            this.generateBuyerNotificationEmail(transfer)
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
      // Find active transfer by code
      const transfer = await Database.selectOne(
        'ownership_transfers',
        '*',
        'transfer_code = ? AND status = ?',
        [transferCode, 'active']
      );

      if (!transfer) {
        return {
          success: false,
          error: 'Invalid transfer code or transfer not available'
        };
      }

      // Check if transfer expired
      if (new Date() > new Date(transfer.expires_at)) {
        await this.expireTransfer(transfer.id);
        return {
          success: false,
          error: 'Transfer has expired'
        };
      }

      // If buyer OTP not yet sent or provided, handle OTP step
      if (!transfer.buyer_otp_code) {
        // Generate and send buyer OTP, update status to awaiting buyer OTP
        const otpCode = this.generateOTP();
        const otpExpiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);

        await Database.update(
          'ownership_transfers',
          {
            buyer_otp_code: otpCode,
            buyer_otp_expires_at: otpExpiresAt,
            status: 'awaiting_buyer_otp',
            updated_at: new Date()
          },
          'id = ?',
          [transfer.id]
        );

        // Get buyer details
        const buyer = await Database.selectOne('users', 'name, email', 'id = ?', [buyerUserId]);

        // Send OTP to buyer (do not fail transfer on email errors)
        try {
          await NotificationService.sendEmailDirect(
            buyer.email,
            'Verify Ownership Receipt - Check It Registry',
            `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #646cff; color: white; padding: 20px; text-align: center;">
                  <h1>🔐 Verify Receipt</h1>
                </div>
                <div style="padding: 30px; background: #f9f9f9;">
                  <p>Hello ${buyer.name || ''},</p>
                  <p>Use this verification code to confirm you are receiving the device:</p>
                  <div style="background: white; padding: 30px; text-align: center; margin: 20px 0; border: 3px solid #646cff; border-radius: 10px;">
                    <h1 style="color: #646cff; font-size: 48px; margin: 0; letter-spacing: 10px; font-family: monospace;">${otpCode}</h1>
                    <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">This code expires in ${this.OTP_EXPIRY_MINUTES} minutes</p>
                  </div>
                  <p>Transfer Code: <span style="font-family: monospace; color: #646cff;">${transferCode}</span></p>
                </div>
              </div>
            `
          );
        } catch (emailErr) {
          console.error('Buyer OTP email send error:', emailErr);
        }

        return {
          success: true,
          requiresBuyerOtp: true,
          transferId: transfer.id,
          // In non-production, expose OTP to ease local testing if email fails
          devOtpCode: (process.env.NODE_ENV !== 'production') ? otpCode : undefined,
          message: 'Verification code sent to your email'
        };
      }

      // Verify buyer OTP if provided
      if (!buyerOtpCode) {
        return {
          success: false,
          error: 'Buyer verification code is required'
        };
      }

      if (transfer.buyer_otp_code !== buyerOtpCode) {
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

      // Update device ownership
      await Database.update(
        'devices',
        {
          user_id: buyerUserId,
          updated_at: new Date()
        },
        'id = ?',
        [transfer.device_id]
      );

      // Update transfer status
      await Database.update(
        'ownership_transfers',
        {
          to_user_id: buyerUserId,
          status: 'completed',
          completed_at: new Date(),
          updated_at: new Date()
        },
        'id = ?',
        [transfer.id]
      );

      // Get user details for notifications
      const [seller, buyer] = await Promise.all([
        Database.selectOne('users', 'name, email', 'id = ?', [transfer.from_user_id]),
        Database.selectOne('users', 'name, email', 'id = ?', [buyerUserId])
      ]);

      // Send completion notifications (do not fail transfer if email sending errors occur)
      try {
        await NotificationService.sendEmailDirect(
          seller.email,
          'Device Transfer Completed - Check It Registry',
          this.generateTransferCompletionEmail(transfer, device, seller, buyer, 'seller')
        );
      } catch (emailErr) {
        console.error('Transfer completion seller email send error:', emailErr);
      }
      try {
        await NotificationService.sendEmailDirect(
          buyer.email,
          'Device Ownership Transferred - Check It Registry',
          this.generateTransferCompletionEmail(transfer, device, seller, buyer, 'buyer')
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
      await Database.update(
        'ownership_transfers',
        {
          status: 'expired',
          updated_at: new Date()
        },
        'id = ?',
        [transferId]
      );

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
        Database.selectOne('users', 'name, email', 'id = ?', [transfer.from_user_id]),
        transfer.buyer_email ? Database.selectOne('users', 'name, email', 'id = ?', [buyerUserId]) : Promise.resolve(null),
        Database.selectOne('devices', 'brand, model, category, imei, serial', 'id = ?', [transfer.device_id])
      ]);

      const subject = 'Device Transfer Rejected - Check It Registry';
      const bodySeller = `The transfer for device ${device.brand} ${device.model} (${device.category}) with code ${transfer.transfer_code} was rejected${buyer ? ` by ${buyer.name}` : ''}. Reason: ${rejectionReason || 'No reason provided.'}`;
      const bodyBuyer = `You have rejected the transfer for device ${device.brand} ${device.model} (${device.category}). Code: ${transfer.transfer_code}.`;

      // Send notifications but do not fail rejection if email sending errors occur
      try {
        await NotificationService.sendEmailDirect(seller.email, subject, bodySeller);
      } catch (emailErr) {
        console.error('Reject transfer seller email send error:', emailErr);
      }
      if (buyer && buyer.email) {
        try {
          await NotificationService.sendEmailDirect(buyer.email, subject, bodyBuyer);
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
        'status',
        'id = ?',
        [deviceId]
      );

      if (!device) {
        return { eligible: false, reason: 'Device not found' };
      }

      if (device.status === 'stolen' || device.status === 'lost') {
        return { eligible: false, reason: 'Cannot transfer stolen or lost devices' };
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
  async getUserTransfers(userId, type = 'all') {
    try {
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

      const transfers = await Database.query(`
        SELECT 
          ot.*,
          d.brand,
          d.model,
          d.category,
          d.imei,
          d.serial,
          seller.name as seller_name,
          seller.email as seller_email,
          buyer.name as buyer_name,
          buyer.email as buyer_email
        FROM ownership_transfers ot
        JOIN devices d ON ot.device_id = d.id
        JOIN users seller ON ot.from_user_id = seller.id
        LEFT JOIN users buyer ON ot.to_user_id = buyer.id
        WHERE ${whereClause}
        ORDER BY ot.created_at DESC
      `, params);

      return transfers.map(transfer => {
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
      });

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
        WHERE status IN ('initiated', 'otp_verified', 'active')
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
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
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
          <h1>🔐 Device Transfer Verification</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Verify Your Device Transfer</h2>
          <p>Hello ${transfer.seller_name},</p>
          <p>You have initiated a transfer for your device:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${transfer.brand} ${transfer.model}</h3>
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
          <p>This is an automated message from Check It Device Registry</p>
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
          <p>Hello ${transfer.seller_name},</p>
          <p>Your device transfer has been activated and is ready for the buyer:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${transfer.brand} ${transfer.model}</h3>
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
          <p>This is an automated message from Check It Device Registry</p>
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
            <h3>${transfer.brand} ${transfer.model}</h3>
            <p><strong>Seller:</strong> ${transfer.seller_name}</p>
            ${transfer.sale_price ? `<p><strong>Price:</strong> $${transfer.sale_price}</p>` : ''}
            <p><strong>Transfer Code:</strong> <span style="font-family: monospace; color: #646cff; letter-spacing: 0.08em;">${transfer.transfer_code}</span></p>
          </div>
          
          <p><strong>To claim ownership:</strong></p>
          <ol>
            <li>Log into your Check It account</li>
            <li>Go to "Device Transfer" → Claim Transfer</li>
            <li>Enter the 12-character transfer code shown above</li>
            <li>If prompted, enter the Email OTP we send you</li>
          </ol>
          
          <p><strong>Important:</strong> The transfer code expires at ${new Date(transfer.expires_at).toLocaleString()}.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Check It Device Registry</p>
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
        SELECT ot.*, u.name as seller_name, u.email as seller_email, d.brand, d.model, d.imei, d.serial
        FROM ownership_transfers ot
        JOIN users u ON ot.from_user_id = u.id
        JOIN devices d ON ot.device_id = d.id
        WHERE ot.id = ?
      `, [transferId]);

      const t = details[0] || transfer;

      await NotificationService.sendEmailDirect(
        t.buyer_email,
        'Device Transfer Code (Resent) - Check It Registry',
        this.generateBuyerNotificationEmail(t)
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

  generateTransferCompletionEmail(transfer, device, seller, buyer, recipient) {
    const isSeller = recipient === 'seller';
    const otherParty = isSeller ? buyer : seller;
    const action = isSeller ? 'transferred to' : 'received from';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
          <h1>🎉 Transfer Complete</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Device Ownership ${isSeller ? 'Transferred' : 'Received'}</h2>
          <p>Hello ${isSeller ? seller.name : buyer.name},</p>
          <p>The device ownership transfer has been completed successfully:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${device.brand} ${device.model}</h3>
            <p><strong>Transfer Code:</strong> ${transfer.transfer_code}</p>
            <p><strong>${isSeller ? 'Buyer' : 'Seller'}:</strong> ${otherParty.name} (${otherParty.email})</p>
            <p><strong>Completed:</strong> ${new Date().toLocaleString()}</p>
            ${transfer.sale_price ? `<p><strong>Sale Price:</strong> $${transfer.sale_price}</p>` : ''}
          </div>
          
          ${isSeller ? `
            <p><strong>Important:</strong> You are no longer the registered owner of this device. The new owner can now manage the device registration.</p>
          ` : `
            <p><strong>Congratulations!</strong> You are now the registered owner of this device. You can manage it through your Check It dashboard.</p>
          `}
          
          <p>This transfer has been recorded in our system for security and legal purposes.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Check It Device Registry</p>
        </div>
      </div>
    `;
  }
}

module.exports = new OwnershipTransferService();