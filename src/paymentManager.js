import debug from 'debug';
import crypto from 'crypto';
import fetch from 'node-fetch';

const log = debug('telegram-bot:payment-manager');

class PaymentManager {
  constructor() {
    this.terminalKey = process.env.TBANK_TERMINAL_KEY || '1750239344961DEMO';
    this.terminalPassword = process.env.TBANK_TERMINAL_PASSWORD || 'HllGrI4oJouWsqSp';
    this.merchantId = process.env.TBANK_MERCHANT_ID || '404516';
    this.apiUrl = 'https://securepay.tinkoff.ru/v2/';
    this.payments = new Map(); // In-memory cache of payment data
  }

  generateToken(params) {
    // Create a copy of the params object
    const tokenParams = { ...params };
    
    // Add password to the params
    tokenParams.Password = this.terminalPassword;
    
    // Remove Token if it exists
    delete tokenParams.Token;
    
    // Sort keys alphabetically
    const sortedParams = {};
    Object.keys(tokenParams).sort().forEach(key => {
      sortedParams[key] = tokenParams[key];
    });
    
    // Concatenate values
    const concatenatedValues = Object.values(sortedParams).join('');
    
    // Calculate SHA-256 hash
    return crypto.createHash('sha256').update(concatenatedValues).digest('hex');
  }

  async initPayment(userId, tariffCode, username) {
    try {
      const { TARIFF_PLANS } = await import('./tariffs.js');
      const tariff = TARIFF_PLANS[tariffCode];
      
      if (!tariff) {
        throw new Error(`Invalid tariff code: ${tariffCode}`);
      }

      // Generate a unique order ID
      const orderId = `${userId}_${tariffCode}_${Date.now()}`;
      
      // Prepare payment data
      const paymentData = {
        TerminalKey: this.terminalKey,
        Amount: tariff.price,
        OrderId: orderId,
        Description: `Тариф ${tariff.name} для @${username || userId}`,
        DATA: {
          userId: userId.toString(),
          tariffCode,
          username: username || ''
        },
        NotificationURL: process.env.PAYMENT_NOTIFICATION_URL,
        SuccessURL: process.env.PAYMENT_SUCCESS_URL,
        FailURL: process.env.PAYMENT_FAIL_URL
      };
      
      // Generate token
      paymentData.Token = this.generateToken(paymentData);
      
      // Make API request to Tinkoff
      const response = await fetch(`${this.apiUrl}Init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentData)
      });
      
      const result = await response.json();
      
      if (!result.Success) {
        throw new Error(`Payment initialization failed: ${result.Message || result.Details || 'Unknown error'}`);
      }
      
      // Store payment data
      this.payments.set(result.PaymentId, {
        paymentId: result.PaymentId,
        userId,
        tariffCode,
        amount: tariff.price,
        status: result.Status,
        orderId,
        createdAt: new Date().toISOString()
      });
      
      return {
        success: true,
        paymentUrl: result.PaymentURL,
        paymentId: result.PaymentId
      };
    } catch (error) {
      log('Error initializing payment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async checkPaymentStatus(paymentId) {
    try {
      const paymentData = {
        TerminalKey: this.terminalKey,
        PaymentId: paymentId
      };
      
      // Generate token
      paymentData.Token = this.generateToken(paymentData);
      
      // Make API request to Tinkoff
      const response = await fetch(`${this.apiUrl}GetState`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentData)
      });
      
      const result = await response.json();
      
      if (!result.Success) {
        throw new Error(`Payment status check failed: ${result.Message || result.Details || 'Unknown error'}`);
      }
      
      // Update payment data in cache
      if (this.payments.has(paymentId)) {
        const payment = this.payments.get(paymentId);
        payment.status = result.Status;
        this.payments.set(paymentId, payment);
      }
      
      return {
        success: true,
        status: result.Status,
        paymentId: result.PaymentId,
        orderId: result.OrderId,
        amount: result.Amount
      };
    } catch (error) {
      log('Error checking payment status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handlePaymentNotification(notification) {
    try {
      // Verify notification token
      const expectedToken = this.generateToken(notification);
      
      if (notification.Token !== expectedToken) {
        throw new Error('Invalid notification token');
      }
      
      // Get payment data
      let paymentData;
      if (this.payments.has(notification.PaymentId)) {
        paymentData = this.payments.get(notification.PaymentId);
      } else {
        // If payment is not in cache, try to get it from Tinkoff
        const paymentStatus = await this.checkPaymentStatus(notification.PaymentId);
        
        if (!paymentStatus.success) {
          throw new Error('Failed to get payment data');
        }
        
        // Try to extract user data from OrderId (userId_tariffCode_timestamp)
        const orderIdParts = paymentStatus.orderId.split('_');
        if (orderIdParts.length >= 2) {
          paymentData = {
            paymentId: notification.PaymentId,
            userId: parseInt(orderIdParts[0], 10),
            tariffCode: orderIdParts[1],
            amount: paymentStatus.amount,
            status: paymentStatus.status,
            orderId: paymentStatus.orderId
          };
          
          this.payments.set(notification.PaymentId, paymentData);
        } else {
          throw new Error('Invalid OrderId format');
        }
      }
      
      // Update payment status
      paymentData.status = notification.Status;
      this.payments.set(notification.PaymentId, paymentData);
      
      return {
        success: true,
        paymentData
      };
    } catch (error) {
      log('Error handling payment notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default PaymentManager;
