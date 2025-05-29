import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import debug from 'debug';
import http from 'node:http';

const log = debug('telegram-bot');
dotenv.config();

// Enhanced error logging
console.log('Starting bot with environment:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DEBUG: process.env.DEBUG,
  BOT_TOKEN_EXISTS: !!process.env.TELEGRAM_BOT_TOKEN
});

// Log environment check
log('Checking environment variables...');
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set');
  log('ERROR: TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}
log('Environment variables checked successfully');

// Create HTTP server for Render
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running');
});

// Initialize bot with polling for production
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
  filepath: false // Disable file downloads
});

// Explicitly bind to PORT from environment or fallback to 3000
const PORT = process.env.PORT || 3000;

// Start server and bot with proper error handling
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server is running on port ${PORT}`);
  log(`Server is running on port ${PORT}`);
  
  try {
    // Test the bot's connection
    const botInfo = await bot.getMe();
    console.log('Bot connected successfully:', botInfo.username);
    log('Bot connected successfully:', botInfo.username);
    
    // Set up message handlers after successful connection
    setupMessageHandlers(bot);
  } catch (error) {
    console.error('Failed to start bot:', error);
    log('Failed to start bot:', error);
    process.exit(1);
  }
});

// Error handling for bot
bot.on('error', (error) => {
  console.error('Bot error:', error);
  log('Bot error:', error);
});

// Error handling for server
server.on('error', (error) => {
  console.error('Server error:', error);
  log('Server error:', error);
  process.exit(1);
});

// Polling error handler
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
  log('Polling error:', error);
  // Don't exit on polling errors, let the bot retry
});

function setupMessageHandlers(bot) {
  // Debug handler for all messages
  bot.on('message', async (msg) => {
    try {
      console.log('Received message:', {
        chatId: msg.chat.id,
        text: msg.text,
        type: msg.text?.startsWith('/') ? 'command' : 'message'
      });
      log('Received message:', msg.text);
      
      if (msg.text === '/ping') {
        await bot.sendMessage(msg.chat.id, 'Pong!');
        console.log('Sent pong response');
      } else if (msg.text === '/start') {
        await bot.sendMessage(msg.chat.id, 
          'Чтобы начать работу, отправь в чат ссылку на аккаунт, который нужно проверить'
        );
        console.log('Sent start message');
      } else if (msg.text && !msg.text.startsWith('/')) {
        await bot.sendMessage(msg.chat.id, 'Message received! Bot is working.');
        console.log('Sent confirmation message');
      }
    } catch (error) {
      console.error('Error processing message:', error);
      log('Error processing message:', error);
      try {
        await bot.sendMessage(msg.chat.id, 'An error occurred. Please try again later.');
      } catch (sendError) {
        console.error('Error sending error message:', sendError);
        log('Error sending error message:', sendError);
      }
    }
  });
}