// Payment Recovery Service - Paid device recovery services
const Database = require('../config');
const NotificationService = require('./NotificationService');

class PaymentRecoveryService {
  constructor() {
    this.packages = {
      basic: {
        name: 'Basic Recovery',
        price: 50.00,
        currency: 'USD',
        duration_days: 7,
        features: [
          'Active monitoring for 7 days',
          'Email alerts for device checks',
          'Basic recovery assistance',
          'Status updates'
        ]
      },
      standard: {
        name: 'Standard Recovery',
        price: 100.00,
        currency: 'USD',
        duration_days: 14,
        features: [
          'Active monitoring for 14 days',
          'Dedicated recovery agent assignment',
          'Priority investigation',
          'Phone support',
          'Law enforcement coordination'
        ]
      },
      premium: {
        name: 'Premium Recovery',
        price: 200.00,
        currency: 'USD',
        duration_days: 30,
        features: [
          'Active monitoring for 30 days',
          'Senior recovery agent assignment',
          'Priority investigation with expedited response',
          '24/7 phone support',
          'Advanced tracking techniques',
          'Insurance coverage up to $500',
          'Legal assistance coordination'
        ]
      }
    };
  }

  // Get available recovery packages
  getRecoveryPackages() {
    return Object.keys(this.packages).map(key => ({
      package: key,
      ...this.packages[key]
    }));
  }

  // Create recovery service request
  async createRecoveryService(serviceData) {
    try {
      const {
        deviceId,
        userId,
        servicePackage,
        paymentMethod = 'stripe'
      } = serviceData;

      // Validate device and user
      const validation = await this.validateRecoveryRequest(deviceId, userId);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }

      const device = validation.device;
      const packageInfo = this.packages[servicePackage];
      
      if (!packageInfo) {
        return {
          success: false,
          error: 'Invalid service package'
        };
      }

      // Check for existing active recovery service
      const existingService = await Database.selectOne(
        'recovery_services',
        'id, status',
        'device_id = ? AND status IN (?, ?, ?, ?)',
        [deviceId, 'payment_pending', 'active', 'investigating', 'leads_found']
      );

      if (existingService) {
        return {
          success: false,
          error: 'Device already has an active recovery service'
        };
      }

      // Create recovery service record
      const serviceId = Database.generateUUID();
      const expiresAt = new Date(Date.now() + packageInfo.duration_days * 24 * 60 * 60 * 1000);

      const recoveryService = {
        id: serviceId,
        device_id: deviceId,
        user_id: userId,
        service_package: servicePackage,
        payment_status: 'pending',
        amount_paid: packageInfo.price,
        currency: packageInfo.currency,
        status: 'payment_pending',
        expires_at: expiresAt,
        created_at: new Date(),
        updated_at: new Date()
      };

      await Database.insert('recovery_services', recoveryService);

      // Create payment intent (mock implementation - replace with actual Stripe)
      const paymentIntent = await this.createPaymentIntent(
        packageInfo.price,
        packageInfo.currency,
        serviceId,
        paymentMethod
      );

      if (!paymentIntent.success) {
        // Cleanup service record
        await Database.query('DELETE FROM recovery_services WHERE id = ?', [serviceId]);
        return {
          success: false,
          error: 'Failed to create payment intent'
        };
      }

      // Update service with payment intent ID
      await Database.update(
        'recovery_services',
        {
          payment_intent_id: paymentIntent.paymentIntentId,
          updated_at: new Date()
        },
        'id = ?',
        [serviceId]
      );

      // Log service creation
      await Database.logAudit(
        userId,
        'RECOVERY_SERVICE_CREATED',
        'recovery_services',
        serviceId,
        null,
        { package: servicePackage, amount: packageInfo.price },
        null
      );

      return {
        success: true,
        serviceId,
        paymentIntentId: paymentIntent.paymentIntentId,
        clientSecret: paymentIntent.clientSecret,
        amount: packageInfo.price,
        currency: packageInfo.currency,
        package: packageInfo,
        expiresAt
      };

    } catch (error) {
      console.error('Recovery service creation error:', error);
      throw error;
    }
  }

  // Process payment completion
  async processPaymentCompletion(paymentIntentId, paymentStatus = 'paid') {
    try {
      // Find recovery service by payment intent
      const service = await Database.selectOne(
        'recovery_services',
        '*',
        'payment_intent_id = ?',
        [paymentIntentId]
      );

      if (!service) {
        return {
          success: false,
          error: 'Recovery service not found'
        };
      }

      if (service.payment_status === 'paid') {
        return {
          success: true,
          message: 'Payment already processed'
        };
      }

      // Update payment status
      await Database.update(
        'recovery_services',
        {
          payment_status: paymentStatus,
          updated_at: new Date()
        },
        'id = ?',
        [service.id]
      );

      if (paymentStatus === 'paid') {
        // Activate recovery service
        await this.activateRecoveryService(service.id);
      } else if (paymentStatus === 'failed') {
        // Mark service as failed
        await Database.update(
          'recovery_services',
          {
            status: 'payment_failed',
            updated_at: new Date()
          },
          'id = ?',
          [service.id]
        );
      }

      return {
        success: true,
        serviceId: service.id,
        status: paymentStatus
      };

    } catch (error) {
      console.error('Payment processing error:', error);
      throw error;
    }
  }

  // Activate recovery service after payment
  async activateRecoveryService(serviceId) {
    try {
      // Get service details
      const serviceDetails = await Database.query(`
        SELECT 
          rs.*,
          d.brand,
          d.model,
          d.imei,
          d.serial,
          d.category,
          u.name as user_name,
          u.email as user_email
        FROM recovery_services rs
        JOIN devices d ON rs.device_id = d.id
        JOIN users u ON rs.user_id = u.id
        WHERE rs.id = ?
      `, [serviceId]);

      if (serviceDetails.length === 0) {
        throw new Error('Recovery service not found');
      }

      const service = serviceDetails[0];

      // Assign recovery agent
      const agent = await this.assignRecoveryAgent(service);

      // Update service status
      await Database.update(
        'recovery_services',
        {
          status: 'active',
          assigned_agent_id: agent?.id || null,
          activated_at: new Date(),
          updated_at: new Date()
        },
        'id = ?',
        [serviceId]
      );

      // Send activation email
      await NotificationService.sendEmailDirect(
        service.user_email,
        'Recovery Service Activated - Check It Registry',
        this.generateActivationEmail(service, agent)
      );

      // Notify assigned agent
      if (agent) {
        await this.notifyAgent(agent, service, 'new_assignment');
      }

      // Log activation
      await Database.logAudit(
        service.user_id,
        'RECOVERY_SERVICE_ACTIVATED',
        'recovery_services',
        serviceId,
        { status: 'payment_pending' },
        { status: 'active', agent_id: agent?.id },
        null
      );

      return {
        success: true,
        agent: agent
      };

    } catch (error) {
      console.error('Service activation error:', error);
      throw error;
    }
  }

  // Assign recovery agent based on specialization and workload
  async assignRecoveryAgent(service) {
    try {
      // Find available agents with matching specialization
      const agents = await Database.query(`
        SELECT *
        FROM recovery_agents
        WHERE is_active = true
        AND active_cases < max_cases
        AND JSON_CONTAINS(specialization, ?)
        ORDER BY active_cases ASC, success_rate DESC
        LIMIT 1
      `, [`"${service.category}"`]);

      if (agents.length === 0) {
        // Fallback to any available agent
        const fallbackAgents = await Database.query(`
          SELECT *
          FROM recovery_agents
          WHERE is_active = true
          AND active_cases < max_cases
          ORDER BY active_cases ASC, success_rate DESC
          LIMIT 1
        `);

        if (fallbackAgents.length === 0) {
          return null; // No agents available
        }

        const agent = fallbackAgents[0];
        
        // Update agent case count
        await Database.update(
          'recovery_agents',
          {
            active_cases: agent.active_cases + 1,
            updated_at: new Date()
          },
          'id = ?',
          [agent.id]
        );

        return agent;
      }

      const agent = agents[0];
      
      // Update agent case count
      await Database.update(
        'recovery_agents',
        {
          active_cases: agent.active_cases + 1,
          updated_at: new Date()
        },
        'id = ?',
        [agent.id]
      );

      return agent;

    } catch (error) {
      console.error('Agent assignment error:', error);
      return null;
    }
  }

  // Update recovery service status
  async updateRecoveryStatus(serviceId, status, notes, agentId) {
    try {
      // Validate status
      const validStatuses = ['active', 'investigating', 'leads_found', 'recovered', 'unsuccessful'];
      if (!validStatuses.includes(status)) {
        return {
          success: false,
          error: 'Invalid status'
        };
      }

      // Get current service
      const service = await Database.selectOne(
        'recovery_services',
        '*',
        'id = ?',
        [serviceId]
      );

      if (!service) {
        return {
          success: false,
          error: 'Recovery service not found'
        };
      }

      // Check agent authorization
      if (agentId && service.assigned_agent_id !== agentId) {
        return {
          success: false,
          error: 'Unauthorized agent'
        };
      }

      const oldStatus = service.status;

      // Update service
      const updateData = {
        status,
        updated_at: new Date()
      };

      if (notes) {
        updateData.service_notes = notes;
      }

      if (status === 'recovered' || status === 'unsuccessful') {
        updateData.completed_at = new Date();
        
        // Update agent case count
        if (service.assigned_agent_id) {
          await Database.query(`
            UPDATE recovery_agents 
            SET active_cases = GREATEST(0, active_cases - 1),
                success_rate = CASE 
                  WHEN ? = 'recovered' THEN 
                    (success_rate * (SELECT COUNT(*) FROM recovery_services WHERE assigned_agent_id = ? AND status IN ('recovered', 'unsuccessful')) + 100) / 
                    (SELECT COUNT(*) FROM recovery_services WHERE assigned_agent_id = ? AND status IN ('recovered', 'unsuccessful') + 1)
                  ELSE success_rate
                END,
                updated_at = NOW()
            WHERE id = ?
          `, [status, service.assigned_agent_id, service.assigned_agent_id, service.assigned_agent_id]);
        }
      }

      await Database.update('recovery_services', updateData, 'id = ?', [serviceId]);

      // Send status update notification
      await this.sendStatusUpdateNotification(serviceId, oldStatus, status);

      // Handle refund for unsuccessful cases
      if (status === 'unsuccessful') {
        await this.processRefund(serviceId);
      }

      // Log status update
      await Database.logAudit(
        agentId || service.user_id,
        'RECOVERY_STATUS_UPDATE',
        'recovery_services',
        serviceId,
        { status: oldStatus },
        { status, notes },
        null
      );

      return {
        success: true,
        message: 'Status updated successfully'
      };

    } catch (error) {
      console.error('Status update error:', error);
      throw error;
    }
  }

  // Process refund for unsuccessful recovery
  async processRefund(serviceId) {
    try {
      const service = await Database.selectOne(
        'recovery_services',
        '*',
        'id = ?',
        [serviceId]
      );

      if (!service || service.payment_status !== 'paid') {
        return { success: false, error: 'Service not eligible for refund' };
      }

      // Calculate refund amount (50% for unsuccessful after 30 days)
      const refundAmount = service.amount_paid * 0.5;

      // Mock refund processing (replace with actual payment processor)
      const refundResult = await this.processPaymentRefund(
        service.payment_intent_id,
        refundAmount
      );

      if (refundResult.success) {
        // Update service status
        await Database.update(
          'recovery_services',
          {
            payment_status: 'refunded',
            status: 'refunded',
            updated_at: new Date()
          },
          'id = ?',
          [serviceId]
        );

        // Send refund notification
        const user = await Database.selectOne('users', 'name, email', 'user_id = ?', [service.user_id]);
        if (user) {
          await NotificationService.sendEmailDirect(
            user.email,
            'Recovery Service Refund Processed - Check It Registry',
            this.generateRefundEmail(service, refundAmount)
          );
        }
      }

      return refundResult;

    } catch (error) {
      console.error('Refund processing error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get user's recovery services
  async getUserRecoveryServices(userId) {
    try {
      const services = await Database.query(`
        SELECT 
          rs.*,
          d.brand,
          d.model,
          d.category,
          d.imei,
          d.serial,
          ra.name as agent_name,
          ra.email as agent_email,
          ra.phone as agent_phone
        FROM recovery_services rs
        JOIN devices d ON rs.device_id = d.id
        LEFT JOIN recovery_agents ra ON rs.assigned_agent_id = ra.id
        WHERE rs.user_id = ?
        ORDER BY rs.created_at DESC
      `, [userId]);

      return services.map(service => ({
        ...service,
        package_info: this.packages[service.service_package]
      }));

    } catch (error) {
      console.error('Get recovery services error:', error);
      throw error;
    }
  }

  // Validate recovery request
  async validateRecoveryRequest(deviceId, userId) {
    try {
      const device = await Database.selectOne(
        'devices',
        '*',
        'id = ? AND user_id = ?',
        [deviceId, userId]
      );

      if (!device) {
        return { valid: false, error: 'Device not found or not owned by user' };
      }

      if (device.status !== 'stolen' && device.status !== 'lost') {
        return { valid: false, error: 'Recovery service only available for stolen or lost devices' };
      }

      return { valid: true, device };

    } catch (error) {
      console.error('Recovery validation error:', error);
      return { valid: false, error: 'Validation failed' };
    }
  }

  // Mock payment processing functions (replace with actual Stripe integration)
  async createPaymentIntent(amount, currency, serviceId, paymentMethod) {
    try {
      // Mock Stripe payment intent creation
      const paymentIntentId = `pi_mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const clientSecret = `${paymentIntentId}_secret_${Math.random().toString(36).substr(2, 9)}`;

      // In real implementation, use Stripe SDK:
      // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      // const paymentIntent = await stripe.paymentIntents.create({
      //   amount: Math.round(amount * 100), // Convert to cents
      //   currency: currency.toLowerCase(),
      //   metadata: { serviceId }
      // });

      return {
        success: true,
        paymentIntentId,
        clientSecret
      };

    } catch (error) {
      console.error('Payment intent creation error:', error);
      return { success: false, error: error.message };
    }
  }

  async processPaymentRefund(paymentIntentId, amount) {
    try {
      // Mock refund processing
      const refundId = `re_mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // In real implementation, use Stripe SDK:
      // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      // const refund = await stripe.refunds.create({
      //   payment_intent: paymentIntentId,
      //   amount: Math.round(amount * 100)
      // });

      return {
        success: true,
        refundId,
        amount
      };

    } catch (error) {
      console.error('Refund processing error:', error);
      return { success: false, error: error.message };
    }
  }

  // Notification functions
  async sendStatusUpdateNotification(serviceId, oldStatus, newStatus) {
    try {
      const serviceDetails = await Database.query(`
        SELECT 
          rs.*,
          d.brand,
          d.model,
          u.name as user_name,
          u.email as user_email,
          ra.name as agent_name
        FROM recovery_services rs
        JOIN devices d ON rs.device_id = d.id
        JOIN users u ON rs.user_id = u.id
        LEFT JOIN recovery_agents ra ON rs.assigned_agent_id = ra.id
        WHERE rs.id = ?
      `, [serviceId]);

      if (serviceDetails.length === 0) return;

      const service = serviceDetails[0];

      await NotificationService.sendEmailDirect(
        service.user_email,
        `Recovery Update: ${this.getStatusDisplayName(newStatus)} - Check It Registry`,
        this.generateStatusUpdateEmail(service, oldStatus, newStatus)
      );

    } catch (error) {
      console.error('Status notification error:', error);
    }
  }

  async notifyAgent(agent, service, type) {
    try {
      let subject, content;

      switch (type) {
        case 'new_assignment':
          subject = `New Recovery Case Assignment - ${service.brand} ${service.model}`;
          content = this.generateAgentAssignmentEmail(agent, service);
          break;
        default:
          return;
      }

      await NotificationService.sendEmailDirect(agent.email, subject, content);

    } catch (error) {
      console.error('Agent notification error:', error);
    }
  }

  // Utility functions
  getStatusDisplayName(status) {
    const statusNames = {
      payment_pending: 'Payment Pending',
      active: 'Active Monitoring',
      investigating: 'Under Investigation',
      leads_found: 'Leads Found',
      recovered: 'Device Recovered',
      unsuccessful: 'Recovery Unsuccessful',
      refunded: 'Refunded'
    };

    return statusNames[status] || status;
  }

  // Email templates
  generateActivationEmail(service, agent) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
          <h1>🚀 Recovery Service Activated</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Your Recovery Service is Now Active</h2>
          <p>Hello ${service.user_name},</p>
          <p>Your ${this.packages[service.service_package].name} recovery service has been activated for:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${service.brand} ${service.model}</h3>
            <p><strong>Service Package:</strong> ${this.packages[service.service_package].name}</p>
            <p><strong>Active Until:</strong> ${new Date(service.expires_at).toLocaleDateString()}</p>
            ${agent ? `<p><strong>Assigned Agent:</strong> ${agent.name}</p>` : ''}
          </div>
          
          <p><strong>What happens next:</strong></p>
          <ul>
            <li>Our system will actively monitor for your device</li>
            <li>You'll receive alerts when your device is checked</li>
            ${agent ? `<li>Your assigned agent will investigate leads</li>` : ''}
            <li>We'll coordinate with law enforcement as needed</li>
            <li>You'll receive regular status updates</li>
          </ul>
          
          ${agent ? `
            <div style="background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Your Recovery Agent:</strong></p>
              <p>Name: ${agent.name}<br>
              Email: ${agent.email}<br>
              ${agent.phone ? `Phone: ${agent.phone}<br>` : ''}
              Specialization: ${JSON.parse(agent.specialization || '[]').join(', ')}</p>
            </div>
          ` : ''}
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Check It Device Registry</p>
        </div>
      </div>
    `;
  }

  generateStatusUpdateEmail(service, oldStatus, newStatus) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #646cff; color: white; padding: 20px; text-align: center;">
          <h1>📋 Recovery Status Update</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Recovery Progress Update</h2>
          <p>Hello ${service.user_name},</p>
          <p>There's an update on your recovery service for:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>${service.brand} ${service.model}</h3>
            <p><strong>Status:</strong> ${this.getStatusDisplayName(oldStatus)} → <strong>${this.getStatusDisplayName(newStatus)}</strong></p>
            ${service.agent_name ? `<p><strong>Agent:</strong> ${service.agent_name}</p>` : ''}
            ${service.service_notes ? `<p><strong>Notes:</strong> ${service.service_notes}</p>` : ''}
          </div>
          
          ${newStatus === 'recovered' ? `
            <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px;">
              <h4 style="color: #155724;">🎉 Great News!</h4>
              <p style="color: #155724;">Your device has been recovered! We'll be in touch with details on how to retrieve it.</p>
            </div>
          ` : newStatus === 'unsuccessful' ? `
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 5px;">
              <h4 style="color: #721c24;">Recovery Update</h4>
              <p style="color: #721c24;">Unfortunately, we were unable to recover your device. A partial refund has been processed to your original payment method.</p>
            </div>
          ` : ''}
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Check It Device Registry</p>
        </div>
      </div>
    `;
  }

  generateRefundEmail(service, refundAmount) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #6c757d; color: white; padding: 20px; text-align: center;">
          <h1>💰 Refund Processed</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Recovery Service Refund</h2>
          <p>Hello,</p>
          <p>We've processed a refund for your recovery service:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Refund Details</h3>
            <p><strong>Device:</strong> ${service.brand} ${service.model}</p>
            <p><strong>Original Amount:</strong> $${service.amount_paid}</p>
            <p><strong>Refund Amount:</strong> $${refundAmount}</p>
            <p><strong>Refund Method:</strong> Original payment method</p>
          </div>
          
          <p>The refund will appear in your account within 5-10 business days.</p>
          <p>We apologize that we couldn't recover your device this time.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Check It Device Registry</p>
        </div>
      </div>
    `;
  }

  generateAgentAssignmentEmail(agent, service) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #dc3545; color: white; padding: 20px; text-align: center;">
          <h1>🎯 New Recovery Case</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Case Assignment</h2>
          <p>Hello ${agent.name},</p>
          <p>You have been assigned a new recovery case:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Case Details</h3>
            <p><strong>Device:</strong> ${service.brand} ${service.model}</p>
            <p><strong>Category:</strong> ${service.category}</p>
            <p><strong>Service Package:</strong> ${this.packages[service.service_package].name}</p>
            <p><strong>Client:</strong> ${service.user_name}</p>
            <p><strong>Active Until:</strong> ${new Date(service.expires_at).toLocaleDateString()}</p>
          </div>
          
          <p>Please log into the agent portal to review case details and begin investigation.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated message from Check It Device Registry</p>
        </div>
      </div>
    `;
  }
}

module.exports = new PaymentRecoveryService();