import { google } from 'googleapis';
import debug from 'debug';

const log = debug('telegram-bot:analytics');

class AnalyticsTracker {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    this.userStats = new Map(); // In-memory cache for user statistics
    this.totalMessages = 0;
    this.totalProfiles = 0;
    this.initialized = false;
  }

  async initialize() {
    try {
      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !this.spreadsheetId) {
        log('Google Sheets credentials not configured, analytics disabled');
        console.log('Analytics disabled: Missing GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SPREADSHEET_ID');
        return false;
      }

      console.log('Initializing Google Sheets analytics...');
      log('Initializing Google Sheets analytics...');

      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      
      // Test the connection first
      try {
        await this.sheets.spreadsheets.get({
          spreadsheetId: this.spreadsheetId
        });
        console.log('Successfully connected to Google Spreadsheet');
        log('Successfully connected to Google Spreadsheet');
      } catch (error) {
        console.error('Failed to connect to Google Spreadsheet:', error.message);
        log('Failed to connect to Google Spreadsheet:', error);
        return false;
      }
      
      // Initialize spreadsheet structure
      await this.initializeSpreadsheet();
      
      this.initialized = true;
      console.log('Analytics tracker initialized successfully');
      log('Analytics tracker initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize analytics tracker:', error.message);
      log('Failed to initialize analytics tracker:', error);
      return false;
    }
  }

  async initializeSpreadsheet() {
    try {
      console.log('Setting up spreadsheet structure...');
      log('Setting up spreadsheet structure...');

      // Check if sheets exist, create if they don't
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const existingSheets = response.data.sheets.map(sheet => sheet.properties.title);
      console.log('Existing sheets:', existingSheets);
      log('Existing sheets:', existingSheets);
      
      const requiredSheets = [
        { title: 'Messages', headers: ['Timestamp', 'User ID', 'Username', 'Message', 'Message Type'] },
        { title: 'Profile Requests', headers: ['Timestamp', 'User ID', 'Username', 'Profile URL', 'Success'] },
        { title: 'User Statistics', headers: ['User ID', 'Username', 'Total Messages', 'Profile Requests', 'First Seen', 'Last Seen', 'Tariff', 'Checks Remaining', 'Checks Used', 'Tariff Start Date', 'Tariff End Date'] },
        { title: 'Summary', headers: ['Metric', 'Value', 'Last Updated'] },
        { title: 'Payments', headers: ['Timestamp', 'User ID', 'Username', 'Payment ID', 'Tariff', 'Amount', 'Status'] }
      ];

      for (const sheetConfig of requiredSheets) {
        if (!existingSheets.includes(sheetConfig.title)) {
          console.log(`Creating sheet: ${sheetConfig.title}`);
          log(`Creating sheet: ${sheetConfig.title}`);
          await this.createSheet(sheetConfig.title, sheetConfig.headers);
        } else {
          console.log(`Sheet already exists: ${sheetConfig.title}`);
          log(`Sheet already exists: ${sheetConfig.title}`);
        }
      }

      // Initialize summary data
      await this.updateSummarySheet();
      
      console.log('Spreadsheet structure setup complete');
      log('Spreadsheet structure setup complete');
      
    } catch (error) {
      console.error('Error initializing spreadsheet:', error.message);
      log('Error initializing spreadsheet:', error);
      throw error;
    }
  }

  async createSheet(title, headers) {
    try {
      // Add new sheet
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: title
              }
            }
          }]
        }
      });

      // Add headers
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: 'RAW',
        resource: {
          values: [headers]
        }
      });

      console.log(`Successfully created sheet: ${title}`);
      log(`Successfully created sheet: ${title}`);
    } catch (error) {
      console.error(`Error creating sheet ${title}:`, error.message);
      log(`Error creating sheet ${title}:`, error);
    }
  }

  async trackMessage(userId, username, message, messageType = 'text') {
    if (!this.initialized) {
      log('Analytics not initialized, skipping message tracking');
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      
      // Update in-memory stats
      this.totalMessages++;
      
      if (!this.userStats.has(userId)) {
        this.userStats.set(userId, {
          username: username || 'Unknown',
          totalMessages: 0,
          profileRequests: 0,
          firstSeen: timestamp,
          lastSeen: timestamp,
          tariff: 'TEST',
          checksRemaining: 5,
          checksUsed: 0,
          tariffStartDate: timestamp,
          tariffEndDate: null
        });
      }
      
      const userStat = this.userStats.get(userId);
      userStat.totalMessages++;
      userStat.lastSeen = timestamp;
      userStat.username = username || userStat.username;

      // Log to Messages sheet
      await this.appendToSheet('Messages', [
        timestamp,
        userId,
        username || 'Unknown',
        message.substring(0, 500), // Limit message length
        messageType
      ]);

      log(`Tracked message from user ${userId}`);
    } catch (error) {
      console.error('Error tracking message:', error.message);
      log('Error tracking message:', error);
    }
  }

  async trackProfileRequest(userId, username, profileUrl, success = true) {
    if (!this.initialized) {
      log('Analytics not initialized, skipping profile request tracking');
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      
      // Update in-memory stats
      this.totalProfiles++;
      
      if (!this.userStats.has(userId)) {
        this.userStats.set(userId, {
          username: username || 'Unknown',
          totalMessages: 0,
          profileRequests: 0,
          firstSeen: timestamp,
          lastSeen: timestamp,
          tariff: 'TEST',
          checksRemaining: 5,
          checksUsed: 0,
          tariffStartDate: timestamp,
          tariffEndDate: null
        });
      }
      
      const userStat = this.userStats.get(userId);
      userStat.profileRequests++;
      userStat.lastSeen = timestamp;
      userStat.username = username || userStat.username;

      // Log to Profile Requests sheet
      await this.appendToSheet('Profile Requests', [
        timestamp,
        userId,
        username || 'Unknown',
        profileUrl,
        success ? 'Yes' : 'No'
      ]);

      log(`Tracked profile request from user ${userId}: ${profileUrl}`);
    } catch (error) {
      console.error('Error tracking profile request:', error.message);
      log('Error tracking profile request:', error);
    }
  }

  async trackTariffAssignment(userId, username, tariffCode, amount, paymentId = null) {
    if (!this.initialized) {
      log('Analytics not initialized, skipping tariff assignment tracking');
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      
      // Log to Payments sheet
      await this.appendToSheet('Payments', [
        timestamp,
        userId,
        username || 'Unknown',
        paymentId || 'Manual',
        tariffCode,
        amount,
        'COMPLETED'
      ]);

      log(`Tracked tariff assignment for user ${userId}: ${tariffCode}`);
    } catch (error) {
      console.error('Error tracking tariff assignment:', error.message);
      log('Error tracking tariff assignment:', error);
    }
  }

  async saveUserData(userData) {
    if (!this.initialized) {
      log('Analytics not initialized, skipping user data save');
      return false;
    }

    try {
      // Update in-memory stats
      this.userStats.set(userData.userId, {
        username: userData.username || 'Unknown',
        totalMessages: userData.totalMessages || 0,
        profileRequests: userData.profileRequests || 0,
        firstSeen: userData.firstSeen || new Date().toISOString(),
        lastSeen: userData.lastSeen || new Date().toISOString(),
        tariff: userData.tariff || 'TEST',
        checksRemaining: userData.checksRemaining || 5,
        checksUsed: userData.checksUsed || 0,
        tariffStartDate: userData.tariffStartDate || new Date().toISOString(),
        tariffEndDate: userData.tariffEndDate || null
      });

      // We'll update the User Statistics sheet during the next sync
      return true;
    } catch (error) {
      console.error('Error saving user data:', error.message);
      log('Error saving user data:', error);
      return false;
    }
  }

  async getUserData(userId) {
    if (!this.initialized) {
      log('Analytics not initialized, skipping get user data');
      return null;
    }

    try {
      // Check in-memory cache first
      if (this.userStats.has(userId)) {
        return {
          userId,
          ...this.userStats.get(userId)
        };
      }

      // Try to get from Google Sheets
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'User Statistics!A:K'
      });

      const rows = response.data.values || [];
      if (rows.length <= 1) {
        return null; // Only header row exists
      }

      // Find user in the sheet
      const headers = rows[0];
      const userIdIndex = headers.indexOf('User ID');
      
      if (userIdIndex === -1) {
        return null; // User ID column not found
      }

      const userRow = rows.find(row => row[userIdIndex] == userId);
      
      if (!userRow) {
        return null; // User not found
      }

      // Map row data to user object
      const userData = {
        userId: parseInt(userRow[headers.indexOf('User ID')], 10),
        username: userRow[headers.indexOf('Username')],
        totalMessages: parseInt(userRow[headers.indexOf('Total Messages')], 10) || 0,
        profileRequests: parseInt(userRow[headers.indexOf('Profile Requests')], 10) || 0,
        firstSeen: userRow[headers.indexOf('First Seen')],
        lastSeen: userRow[headers.indexOf('Last Seen')],
        tariff: userRow[headers.indexOf('Tariff')] || 'TEST',
        checksRemaining: parseInt(userRow[headers.indexOf('Checks Remaining')], 10) || 5,
        checksUsed: parseInt(userRow[headers.indexOf('Checks Used')], 10) || 0,
        tariffStartDate: userRow[headers.indexOf('Tariff Start Date')],
        tariffEndDate: userRow[headers.indexOf('Tariff End Date')] || null
      };

      // Update in-memory cache
      this.userStats.set(userId, {
        username: userData.username,
        totalMessages: userData.totalMessages,
        profileRequests: userData.profileRequests,
        firstSeen: userData.firstSeen,
        lastSeen: userData.lastSeen,
        tariff: userData.tariff,
        checksRemaining: userData.checksRemaining,
        checksUsed: userData.checksUsed,
        tariffStartDate: userData.tariffStartDate,
        tariffEndDate: userData.tariffEndDate
      });

      return userData;
    } catch (error) {
      console.error('Error getting user data:', error.message);
      log('Error getting user data:', error);
      return null;
    }
  }

  async appendToSheet(sheetName, values) {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [values]
        }
      });
    } catch (error) {
      console.error(`Error appending to sheet ${sheetName}:`, error.message);
      log(`Error appending to sheet ${sheetName}:`, error);
    }
  }

  async updateUserStatistics() {
    if (!this.initialized) return;

    try {
      // FIXED: Instead of clearing all data, we'll merge existing data with cached data
      
      // First, get all existing data from the sheet
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'User Statistics!A:K'
      });

      const rows = response.data.values || [];
      const headers = rows.length > 0 ? rows[0] : [];
      const existingData = rows.slice(1); // Skip header row

      // Create a map of existing users by User ID
      const existingUsers = new Map();
      const userIdIndex = headers.indexOf('User ID');
      
      if (userIdIndex !== -1) {
        existingData.forEach(row => {
          if (row[userIdIndex]) {
            const userId = parseInt(row[userIdIndex], 10);
            if (!isNaN(userId)) {
              existingUsers.set(userId, row);
            }
          }
        });
      }

      log(`Found ${existingUsers.size} existing users in spreadsheet`);
      log(`Have ${this.userStats.size} users in cache`);

      // Merge cached users with existing users
      for (const [userId, stats] of this.userStats.entries()) {
        const userData = [
          userId,
          stats.username,
          stats.totalMessages,
          stats.profileRequests,
          stats.firstSeen,
          stats.lastSeen,
          stats.tariff || 'TEST',
          stats.checksRemaining || 5,
          stats.checksUsed || 0,
          stats.tariffStartDate || stats.firstSeen,
          stats.tariffEndDate || ''
        ];
        
        // Update or add user data
        existingUsers.set(userId, userData);
      }

      // Convert map back to array
      const allUserData = Array.from(existingUsers.values());
      
      log(`Total users to write: ${allUserData.length}`);

      if (allUserData.length > 0) {
        // Clear existing data (except headers) and write all data
        await this.sheets.spreadsheets.values.clear({
          spreadsheetId: this.spreadsheetId,
          range: 'User Statistics!A2:K'
        });

        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: 'User Statistics!A2',
          valueInputOption: 'RAW',
          resource: {
            values: allUserData
          }
        });

        log(`Successfully updated user statistics with ${allUserData.length} users`);
      }

    } catch (error) {
      console.error('Error updating user statistics:', error.message);
      log('Error updating user statistics:', error);
    }
  }

  async updateSummarySheet() {
    if (!this.initialized) return;

    try {
      const timestamp = new Date().toISOString();
      
      // Get total unique users from the actual User Statistics sheet
      let totalUniqueUsers = this.userStats.size;
      
      try {
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: 'User Statistics!A:A'
        });
        
        const rows = response.data.values || [];
        // Subtract 1 for header row, but ensure it's not negative
        totalUniqueUsers = Math.max(rows.length - 1, 0);
      } catch (error) {
        log('Error getting user count from sheet, using cache:', error);
      }

      // Count users by tariff from cache (this is approximate)
      const tariffCounts = {};
      for (const [_, stats] of this.userStats.entries()) {
        const tariff = stats.tariff || 'TEST';
        tariffCounts[tariff] = (tariffCounts[tariff] || 0) + 1;
      }

      const summaryData = [
        ['Total Messages', this.totalMessages, timestamp],
        ['Unique Users', totalUniqueUsers, timestamp],
        ['Total Profile Requests', this.totalProfiles, timestamp]
      ];

      // Add tariff counts
      Object.entries(tariffCounts).forEach(([tariff, count]) => {
        summaryData.push([`Users on ${tariff} Tariff (Cache)`, count, timestamp]);
      });

      // Clear existing data (except headers)
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: 'Summary!A2:Z'
      });

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Summary!A2',
        valueInputOption: 'RAW',
        resource: {
          values: summaryData
        }
      });

      log('Updated summary statistics');
    } catch (error) {
      console.error('Error updating summary:', error.message);
      log('Error updating summary:', error);
    }
  }

  // Periodic update method to sync in-memory stats to sheets
  async syncToSheets() {
    if (!this.initialized) {
      log('Analytics not initialized, skipping sync');
      return;
    }

    try {
      await this.updateUserStatistics();
      await this.updateSummarySheet();
      console.log('Analytics synced to Google Sheets successfully');
      log('Synced analytics to Google Sheets');
    } catch (error) {
      console.error('Error syncing to sheets:', error.message);
      log('Error syncing to sheets:', error);
    }
  }

  getStats() {
    return {
      totalMessages: this.totalMessages,
      uniqueUsers: this.userStats.size,
      totalProfiles: this.totalProfiles,
      initialized: this.initialized
    };
  }
}

export default AnalyticsTracker;
