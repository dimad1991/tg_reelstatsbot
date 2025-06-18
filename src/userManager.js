const debug = require('debug')('telegram-bot:user-manager');

class UserManager {
  constructor(analytics) {
    this.analytics = analytics;
    this.users = new Map(); // In-memory cache of user data
  }

  async loadUserData(userId) {
    try {
      // Try to get user from in-memory cache first
      if (this.users.has(userId)) {
        return this.users.get(userId);
      }

      // If not in cache, try to get from analytics
      const userData = await this.analytics.getUserData(userId);
      
      if (userData) {
        this.users.set(userId, userData);
        return userData;
      }

      // If user doesn't exist, create a new user with default TEST tariff
      const newUser = {
        userId,
        tariff: 'TEST',
        checksRemaining: 5,
        checksUsed: 0,
        tariffStartDate: new Date().toISOString(),
        tariffEndDate: null // No expiration for TEST tariff
      };

      this.users.set(userId, newUser);
      await this.analytics.saveUserData(newUser);
      return newUser;
    } catch (error) {
      debug('Error loading user data:', error);
      // Return a default user object if there's an error
      return {
        userId,
        tariff: 'TEST',
        checksRemaining: 5,
        checksUsed: 0,
        tariffStartDate: new Date().toISOString(),
        tariffEndDate: null
      };
    }
  }

  async updateUserData(userData) {
    try {
      this.users.set(userData.userId, userData);
      await this.analytics.saveUserData(userData);
      return true;
    } catch (error) {
      debug('Error updating user data:', error);
      return false;
    }
  }

  async recordProfileCheck(userId) {
    try {
      const userData = await this.loadUserData(userId);
      
      // Check if tariff has expired
      if (userData.tariffEndDate && new Date(userData.tariffEndDate) < new Date()) {
        // Tariff expired, revert to TEST plan with 0 remaining checks
        userData.tariff = 'TEST';
        userData.checksRemaining = 0;
        userData.tariffStartDate = new Date().toISOString();
        userData.tariffEndDate = null;
      }

      // Check if user has remaining checks
      if (userData.checksRemaining <= 0) {
        return {
          success: false,
          reason: 'LIMIT_REACHED',
          userData
        };
      }

      // Update user data
      userData.checksUsed += 1;
      if (userData.checksRemaining !== Infinity) {
        userData.checksRemaining -= 1;
      }
      
      await this.updateUserData(userData);
      
      return {
        success: true,
        userData
      };
    } catch (error) {
      debug('Error recording profile check:', error);
      return {
        success: false,
        reason: 'ERROR',
        error
      };
    }
  }

  async assignTariff(userId, tariffCode, paymentId = null) {
    try {
      const userData = await this.loadUserData(userId);
      const { TARIFF_PLANS } = require('./tariffs');
      
      if (!TARIFF_PLANS[tariffCode]) {
        return {
          success: false,
          reason: 'INVALID_TARIFF'
        };
      }

      const tariff = TARIFF_PLANS[tariffCode];
      const now = new Date();
      
      // Calculate tariff end date if applicable
      let tariffEndDate = null;
      if (tariff.durationDays > 0) {
        tariffEndDate = new Date(now);
        tariffEndDate.setDate(tariffEndDate.getDate() + tariff.durationDays);
        tariffEndDate = tariffEndDate.toISOString();
      }

      // Update user data
      userData.tariff = tariffCode;
      userData.checksRemaining = tariff.maxChecks;
      userData.tariffStartDate = now.toISOString();
      userData.tariffEndDate = tariffEndDate;
      
      if (paymentId) {
        userData.lastPaymentId = paymentId;
      }

      await this.updateUserData(userData);
      
      // Track tariff assignment in analytics
      await this.analytics.trackTariffAssignment(
        userId,
        tariffCode,
        tariff.price,
        paymentId
      );
      
      return {
        success: true,
        userData
      };
    } catch (error) {
      debug('Error assigning tariff:', error);
      return {
        success: false,
        reason: 'ERROR',
        error
      };
    }
  }
}

module.exports = UserManager;

export default UserManager
