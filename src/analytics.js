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
        { title: 'User Statistics', headers: ['User ID', 'Username', 'Total Messages', 'Profile Requests', 'First Seen', 'Last Seen'] },
        { title: 'Summary', headers: ['Metric', 'Value', 'Last Updated'] }
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
          lastSeen: timestamp
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
          lastSeen: timestamp
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
    if (!this.initialized || this.userStats.size === 0) return;

    try {
      // Clear existing data (except headers)
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: 'User Statistics!A2:Z'
      });

      // Prepare user statistics data
      const userData = Array.from(this.userStats.entries()).map(([userId, stats]) => [
        userId,
        stats.username,
        stats.totalMessages,
        stats.profileRequests,
        stats.firstSeen,
        stats.lastSeen
      ]);

      if (userData.length > 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: 'User Statistics!A2',
          valueInputOption: 'RAW',
          resource: {
            values: userData
          }
        });
      }

      log('Updated user statistics');
    } catch (error) {
      console.error('Error updating user statistics:', error.message);
      log('Error updating user statistics:', error);
    }
  }

  async updateSummarySheet() {
    if (!this.initialized) return;

    try {
      const timestamp = new Date().toISOString();
      const uniqueUsers = this.userStats.size;

      const summaryData = [
        ['Total Messages', this.totalMessages, timestamp],
        ['Unique Users', uniqueUsers, timestamp],
        ['Total Profile Requests', this.totalProfiles, timestamp]
      ];

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
