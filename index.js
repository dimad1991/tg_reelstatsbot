import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import debug from 'debug';
import http from 'node:http';
import express from 'express';
import bodyParser from 'body-parser';
import AnalyticsTracker from './src/analytics.js';
import UserManager from './src/userManager.js';
import PaymentManager from './src/paymentManager.js';
import { TARIFF_PLANS, MESSAGES, PAYMENT_BUTTONS } from './src/tariffs.js';

const log = debug('telegram-bot');
dotenv.config();

// Initialize analytics tracker
const analytics = new AnalyticsTracker();

// Log environment check
log('Checking environment variables...');
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set');
  log('ERROR: TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}
log('Environment variables checked successfully');

// Create Express app for handling both bot status and payments
const app = express();
app.use(bodyParser.json());

// Initialize bot variables
let bot = null;
let isPolling = false;
let isShuttingDown = false;

// Initialize managers
let userManager = null;
let paymentManager = null;

// Explicitly bind to PORT from environment or fallback to 3000
const PORT = process.env.PORT || 3000;

// Basic route for health check
app.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running');
});

// Payment notification endpoint
app.post('/payment/notification', async (req, res) => {
  try {
    log('Received payment notification:', req.body);
    
    // Process payment notification
    const result = await paymentManager.handlePaymentNotification(req.body);
    
    if (!result.success) {
      log('Failed to process payment notification:', result.error);
      return res.status(400).send('ERROR');
    }
    
    // If payment is confirmed, assign tariff to user
    if (result.paymentData.status === 'CONFIRMED') {
      const { userId, tariffCode } = result.paymentData;
      
      const tariffResult = await userManager.assignTariff(
        userId,
        tariffCode,
        result.paymentData.paymentId
      );
      
      if (tariffResult.success) {
        // Notify user about successful payment
        try {
          await bot.sendMessage(
            userId,
            `✅ Оплата успешно прошла!\n\nТариф "${TARIFF_PLANS[tariffCode].name}" активирован. Теперь вы можете продолжить использование бота.`
          );
        } catch (error) {
          log('Error sending payment success message to user:', error);
        }
      } else {
        log('Failed to assign tariff to user:', tariffResult.reason);
      }
    }
    
    // Return OK to acknowledge receipt of notification
    return res.status(200).send('OK');
  } catch (error) {
    log('Error handling payment notification:', error);
    return res.status(500).send('ERROR');
  }
});

// Payment success endpoint
app.get('/payment/success', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Оплата успешна</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .success-container {
            max-width: 500px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .success-icon {
            color: #4CAF50;
            font-size: 48px;
            margin-bottom: 20px;
          }
          .btn {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 4px;
            margin-top: 20px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="success-container">
          <div class="success-icon">✓</div>
          <h1>Оплата успешно выполнена!</h1>
          <p>Ваш тариф активирован. Теперь вы можете вернуться в Telegram и продолжить использование бота.</p>
          <a href="https://t.me/reelstats_bot" class="btn">Вернуться к боту</a>
        </div>
      </body>
    </html>
  `);
});

// Payment failure endpoint
app.get('/payment/fail', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Ошибка оплаты</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .fail-container {
            max-width: 500px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .fail-icon {
            color: #F44336;
            font-size: 48px;
            margin-bottom: 20px;
          }
          .btn {
            display: inline-block;
            background-color: #2196F3;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 4px;
            margin-top: 20px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="fail-container">
          <div class="fail-icon">✗</div>
          <h1>Ошибка оплаты</h1>
          <p>К сожалению, произошла ошибка при обработке платежа. Пожалуйста, попробуйте еще раз или свяжитесь с поддержкой.</p>
          <a href="https://t.me/reelstats_bot" class="btn">Вернуться к боту</a>
        </div>
      </body>
    </html>
  `);
});

// Function to clear any existing webhooks
async function clearWebhook() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteWebhook`);
    const result = await response.json();
    console.log('Webhook deletion result:', result);
    log('Webhook deletion result:', result);
    return result.ok;
  } catch (error) {
    console.error('Error deleting webhook:', error);
    log('Error deleting webhook:', error);
    return false;
  }
}

// Function to start bot polling with retry logic
async function startBotPolling(retryCount = 0) {
  const maxRetries = 3;
  
  if (isShuttingDown) {
    console.log('Shutdown in progress, skipping bot start');
    return false;
  }

  try {
    // Clear any existing webhooks first
    await clearWebhook();
    
    // Wait a bit after clearing webhook
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create new bot instance if needed
    if (!bot) {
      bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
        polling: false
      });
    }

    // Start polling
    await bot.startPolling({
      restart: false,
      polling: {
        interval: 1000,
        autoStart: false,
        params: {
          timeout: 10,
          allowed_updates: ['message', 'callback_query']
        }
      }
    });

    isPolling = true;
    console.log('Bot polling started successfully');
    log('Bot polling started successfully');
    
    // Initialize managers
    userManager = new UserManager(analytics);
    paymentManager = new PaymentManager();
    
    // Set up message handlers
    setupMessageHandlers(bot);
    
    return true;
  } catch (error) {
    console.error(`Failed to start bot polling (attempt ${retryCount + 1}):`, error);
    log(`Failed to start bot polling (attempt ${retryCount + 1}):`, error);
    
    if (error.message.includes('409') || error.message.includes('Conflict')) {
      if (retryCount < maxRetries) {
        const delay = (retryCount + 1) * 5000; // Increasing delay
        console.log(`Polling conflict detected. Retrying in ${delay/1000} seconds...`);
        log(`Polling conflict detected. Retrying in ${delay/1000} seconds...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return startBotPolling(retryCount + 1);
      } else {
        console.error('Max retries reached for polling conflicts');
        log('Max retries reached for polling conflicts');
        return false;
      }
    }
    
    return false;
  }
}

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  console.log(`Received ${signal}. Graceful shutdown...`);
  log(`Received ${signal}. Graceful shutdown...`);
  
  if (bot && isPolling) {
    try {
      await bot.stopPolling();
      isPolling = false;
      console.log('Bot polling stopped');
      log('Bot polling stopped');
    } catch (error) {
      console.error('Error stopping bot polling:', error);
      log('Error stopping bot polling:', error);
    }
  }
  
  // Sync analytics one last time
  try {
    await analytics.syncToSheets();
    console.log('Final analytics sync completed');
    log('Final analytics sync completed');
  } catch (error) {
    console.error('Error in final analytics sync:', error);
    log('Error in final analytics sync:', error);
  }
  
  server.close(() => {
    console.log('Server closed');
    log('Server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('Force exit after timeout');
    process.exit(1);
  }, 10000);
};

// Handle process signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  log('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  log('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Function to create payment buttons (stacked vertically)
function createPaymentButtons() {
  return PAYMENT_BUTTONS.map(button => {
    if (button.url) {
      return [{
        text: button.text,
        url: button.url
      }];
    } else {
      return [{
        text: button.text,
        callback_data: `tariff_${button.tariff}`
      }];
    }
  });
}

// Function to check if user can make a profile request
async function checkUserCanMakeRequest(userId, username) {
  try {
    const result = await userManager.canMakeRequest(userId);
    
    if (!result.success) {
      // User has reached their limit
      const userData = result.userData;
      const messageTemplate = userData.tariff === 'TEST' ? 
        MESSAGES.LIMIT_REACHED_TEST : 
        MESSAGES.LIMIT_REACHED_PAID;
      
      // Send limit reached message with payment buttons
      await bot.sendMessage(
        userId,
        messageTemplate,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: createPaymentButtons()
          }
        }
      );
      
      return false;
    }
    
    return true;
  } catch (error) {
    log('Error checking if user can make request:', error);
    return true; // Allow request in case of error
  }
}

// Function to handle tariff selection
async function handleTariffSelection(userId, username, tariffCode) {
  try {
    // Initialize payment
    const result = await paymentManager.initPayment(userId, tariffCode, username);
    
    if (!result.success) {
      await bot.sendMessage(
        userId,
        `❌ Ошибка при создании платежа: ${result.error}\n\nПожалуйста, попробуйте позже или обратитесь к @dimadubovik.`
      );
      return;
    }
    
    // Send payment link to user
    await bot.sendMessage(
      userId,
      `🔗 Для оплаты тарифа "${TARIFF_PLANS[tariffCode].name}" перейдите по ссылке:\n\n${result.paymentUrl}\n\nПосле успешной оплаты вы получите уведомление, и тариф будет активирован автоматически.`,
      {
        disable_web_page_preview: true
      }
    );
  } catch (error) {
    log('Error handling tariff selection:', error);
    await bot.sendMessage(
      userId,
      '❌ Произошла ошибка при обработке выбора тарифа. Пожалуйста, попробуйте позже или обратитесь к @dimadubovik.'
    );
  }
}

function setupMessageHandlers(bot) {
  bot.onText(/\/start/, async (msg) => {
    try {
      log('Received /start command from:', msg.chat.id);
      
      // Track the message
      await analytics.trackMessage(
        msg.from.id, 
        msg.from.username, 
        '/start', 
        'command'
      );
      
      await bot.sendMessage(msg.chat.id, 
        'Чтобы начать работу, отправь в чат ссылку на аккаунт, который нужно проверить'
      );
      log('Welcome message sent successfully to:', msg.chat.id);
    } catch (error) {
      log('Error sending welcome message:', error);
      try {
        await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
      } catch (retryError) {
        log('Error sending error message:', retryError);
      }
    }
  });

  // Add tariff info command
  bot.onText(/\/tariff/, async (msg) => {
    try {
      log('Received /tariff command from:', msg.chat.id);
      
      // Track the message
      await analytics.trackMessage(
        msg.from.id, 
        msg.from.username, 
        '/tariff', 
        'command'
      );
      
      // Get user data
      const userData = await userManager.loadUserData(msg.from.id);
      const tariff = TARIFF_PLANS[userData.tariff];
      
      let tariffEndInfo = '';
      if (userData.tariffEndDate) {
        const endDate = new Date(userData.tariffEndDate);
        tariffEndInfo = `\nДействует до: ${endDate.toLocaleDateString()}`;
      }
      
      await bot.sendMessage(
        msg.chat.id,
        `📊 *Информация о вашем тарифе*\n\nТариф: *${tariff.name}*\nОсталось проверок: *${userData.checksRemaining}*\nИспользовано проверок: *${userData.checksUsed}*${tariffEndInfo}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: createPaymentButtons()
          }
        }
      );
    } catch (error) {
      log('Error sending tariff info:', error);
      try {
        await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
      } catch (retryError) {
        log('Error sending error message:', retryError);
      }
    }
  });

  // Add admin command to set user tariff
  bot.onText(/\/admin_set_tariff(.*)/, async (msg, match) => {
    try {
      // Check if user is admin
      if (msg.from.id.toString() !== process.env.ADMIN_USER_ID) {
        return; // Silently ignore if not admin
      }
      
      const params = match[1].trim().split(' ').filter(p => p.length > 0);
      if (params.length < 2) {
        await bot.sendMessage(msg.chat.id, 'Usage: /admin_set_tariff [user_id] [tariff_code]\n\nAvailable tariff codes: ' + Object.keys(TARIFF_PLANS).join(', '));
        return;
      }
      
      const targetUserId = parseInt(params[0], 10);
      const tariffCode = params[1].toUpperCase();
      
      if (!TARIFF_PLANS[tariffCode]) {
        await bot.sendMessage(msg.chat.id, `Invalid tariff code. Available tariffs: ${Object.keys(TARIFF_PLANS).join(', ')}`);
        return;
      }
      
      // Assign tariff to user
      const result = await userManager.assignTariff(targetUserId, tariffCode);
      
      if (result.success) {
        await bot.sendMessage(msg.chat.id, `✅ Successfully assigned tariff ${tariffCode} to user ${targetUserId}`);
        
        // Notify user about tariff change
        try {
          await bot.sendMessage(
            targetUserId,
            `✅ Ваш тариф был изменен администратором на "${TARIFF_PLANS[tariffCode].name}".\n\nДоступно проверок: ${result.userData.checksRemaining}`
          );
        } catch (notifyError) {
          log('Error notifying user about tariff change:', notifyError);
        }
      } else {
        await bot.sendMessage(msg.chat.id, `❌ Failed to assign tariff: ${result.reason}`);
      }
    } catch (error) {
      log('Error handling admin_set_tariff command:', error);
      await bot.sendMessage(msg.chat.id, 'An error occurred while processing the command.');
    }
  });

  bot.on('callback_query', async (query) => {
    try {
      const chatId = query.message.chat.id;

      // Track callback query
      await analytics.trackMessage(
        query.from.id,
        query.from.username,
        `callback: ${query.data}`,
        'callback'
      );

      if (query.data === 'forecast_info') {
        await bot.sendMessage(chatId, FORECAST_INFO);
      } else if (query.data === 'contact_author') {
        await bot.sendMessage(chatId, AUTHOR_INFO);
      } else if (query.data.startsWith('tariff_')) {
        // Handle tariff selection
        const tariffCode = query.data.split('_')[1];
        await handleTariffSelection(query.from.id, query.from.username, tariffCode);
      }

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      log('Error handling callback query:', error);
    }
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    try {
      log('Processing message:', msg.text);
      
      // Track the message
      await analytics.trackMessage(
        msg.from.id,
        msg.from.username,
        msg.text,
        'text'
      );
      
      let url = msg.text.trim();
      
      if (url.startsWith('@') || !url.includes('/')) {
        url = await normalizeInstagramInput(url);
      }
      
      const isValidUrl = url.toLowerCase().includes('instagram.com') || url.toLowerCase().includes('tiktok.com');
      if (!isValidUrl) {
        await bot.sendMessage(msg.chat.id, 'Чтобы получить статистику по нужному вам профилю, *отправьте 🔗 ссылку* или *username* на аккаунт в бот.', { parse_mode: 'Markdown' });
        return;
      }

      // Check if user can make this request (has remaining checks)
      const canMakeRequest = await checkUserCanMakeRequest(msg.from.id, msg.from.username);
      if (!canMakeRequest) {
        return;
      }

      await bot.sendMessage(msg.chat.id, 'Работаю ⚙️ Не уходите из чата, это займет меньше минуты.');

      let success = false;
      try {
        const stats = await fetchSocialStats(url);
        success = true;
        
        // Only deduct check after successful stats retrieval
        await userManager.recordProfileCheck(msg.from.id);
        
        // Track successful profile request
        await analytics.trackProfileRequest(
          msg.from.id,
          msg.from.username,
          url,
          true
        );
        
        // Escape special characters for Markdown
        const escapedFullName = stats.fullName.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
        const escapedUrl = stats.profileUrl.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
        
        const response = `*Имя:* ${escapedFullName}
*URL:* ${escapedUrl}
—————————————————

*👁️ Информация об аккаунте:*

• Подписчиков — ${stats.followers.toLocaleString()}
• Подписок — ${stats.following.toLocaleString()}
• Всего публикаций — ${stats.totalPosts.toLocaleString()}
—————————————————

*📊 Статистика Аккаунта*
*(за последние 30 дней):*

• Публикаций — ${stats.postsLast30Days.toLocaleString()}
• ER [ⓘ](https://telegra.ph/Formula-Engagement-Rate-ER-06-05) — ${stats.accountER.toFixed(2)}%
—————————————————

*📊 Статистика Reels*
*(за последние 30 дней):*

• Reels — ${stats.reelsLast30Days.toLocaleString()}
• Медиана просмотров [ⓘ](https://telegra.ph/Formula-Mediany-prosmotrov-06-05) — ${stats.medianViews30Days.toLocaleString()}
• ER [ⓘ](https://telegra.ph/Formula-Engagement-Rate-ER-06-05) — ${stats.reelsER30Days.toFixed(2)}%
• ERV [ⓘ](https://telegra.ph/Formula-Engagement-Rate-Views-ERV-06-05) — ${stats.reelsERR30Days.toFixed(2)}%
—————————————————

*📈 Прогноз Reels:*

• Охват [ⓘ](https://telegra.ph/Formula-prognoza-ohvatov-Reels-06-05) — ${Math.round(stats.predictedReach).toLocaleString()}
• ER — ${stats.predictedER.toFixed(2)}%
• ERV — ${stats.predictedERR.toFixed(2)}%
—————————————————

Чтобы получить статистику по нужному вам профилю, отправьте ссылку или username на аккаунт в бот\\.`;

        const inlineKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Как бот составляет прогноз?',
                  callback_data: 'forecast_info'
                }
              ],
              [
                {
                  text: 'Связаться с автором бота',
                  callback_data: 'contact_author'
                }
              ]
            ]
          },
          parse_mode: 'Markdown'
        };

        await bot.sendMessage(msg.chat.id, response, inlineKeyboard);
        log('Stats sent successfully for URL:', url);
      } catch (error) {
        // Track failed profile request
        await analytics.trackProfileRequest(
          msg.from.id,
          msg.from.username,
          url,
          false
        );
        
        log('Error processing message:', error);
        
        // Check for specific error types
        let errorMessage = error.message;
        if (error.message === 'PROFILE_NOT_FOUND') {
          errorMessage = 'К сожалению, это закрытый аккаунт. Автор установил настройки в режиме «private». Мы не можем проанализировать данные.';
        }
        
        await bot.sendMessage(msg.chat.id, errorMessage);
      }
    } catch (error) {
      log('Error in message handler:', error);
      await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
    }
  });
}

// Start server and bot
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server is running on port ${PORT}`);
  log(`Server is running on port ${PORT}`);
  
  try {
    // Initialize analytics first
    const analyticsInitialized = await analytics.initialize();
    if (analyticsInitialized) {
      console.log('Analytics initialized successfully');
      log('Analytics initialized successfully');
    } else {
      console.log('Analytics initialization skipped (credentials not configured)');
      log('Analytics initialization skipped (credentials not configured)');
    }
    
    // Start bot polling
    const botStarted = await startBotPolling();
    
    if (!botStarted) {
      console.error('Failed to start bot after all retries');
      log('Failed to start bot after all retries');
      process.exit(1);
    }
    
    // Set up periodic analytics sync (every 5 minutes)
    if (analyticsInitialized) {
      setInterval(async () => {
        if (!isShuttingDown) {
          try {
            await analytics.syncToSheets();
            log('Periodic analytics sync completed');
          } catch (error) {
            log('Error in periodic analytics sync:', error);
          }
        }
      }, 5 * 60 * 1000);
    }
    
    console.log('Bot and server are both running');
    log('Bot and server are both running');
  } catch (error) {
    console.error('Failed to start application:', error);
    log('Failed to start application:', error);
    process.exit(1);
  }
});

// Error handling for server
server.on('error', (error) => {
  console.error('Server error:', error);
  log('Server error:', error);
  if (!isShuttingDown) {
    process.exit(1);
  }
});

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const LOCK_FILE = path.join(process.cwd(), 'bot.lock');

// Circuit breaker configuration
const CIRCUIT_BREAKER = {
  failures: 0,
  lastFailure: null,
  threshold: 3,
  resetTimeout: 5 * 60 * 1000, // 5 minutes
};

const FORECAST_INFO = `За основу мы берем медианные значения просмотров Reels, ER Reels, ERR Reels в аккаунте за последний период.  

Используя собственный опыт, экспертизу в работе с Instagram и методы анализа с помощью ИИ мы вывели формулу зависимости охватов от нескольких дополнительных параметров.   

Каждый из параметров трансформирован в коэффициент, на который умножается базовое значение медианы.  

Примеры влияющих на итоговый прогноз параметров: частота публикации Reels в профиле, динамика изменения ER и ERR, прострелы Reels по охватам за определенный период времени, категория блога и др.   

В итоге мы получаем прогнозируемое значение. На итоговые охваты вашей интеграции влияют субъективные факторы, которые мы предусмотреть не можем: использование популярных треков, нативность/рекламность интеграции, использование продуктов в тематике блогера и др.`;

const AUTHOR_INFO = `Привет! Я Дима, CEO и сооснователь UGC платформы Uno Dos Trends -> https://t.me/dimadubovik

Этот бот был создан, чтобы помочь нам внутри прогнозировать результаты от работы с блогерами, но вышел за рамки нашей команды. 

C предложениями по улучшению или просто так пишите в личку -> https://t.me/dimadubovik`;

const checkBotLock = () => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
      log('Removed existing lock file');
      return false;
    }
    return false;
  } catch (error) {
    log('Error handling lock file:', error);
    return false;
  }
};

const createBotLock = () => {
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ 
      pid: process.pid,
      timestamp: Date.now()
    }));
  } catch (error) {
    log('Error creating lock file:', error);
  }
};

const removeBotLock = () => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (error) {
    log('Error removing lock file:', error);
  }
};

const checkCircuitBreaker = () => {
  if (CIRCUIT_BREAKER.failures >= CIRCUIT_BREAKER.threshold) {
    const now = Date.now();
    if (now - CIRCUIT_BREAKER.lastFailure < CIRCUIT_BREAKER.resetTimeout) {
      throw new Error('Service temporarily unavailable. Please try again in a few minutes.');
    }
    CIRCUIT_BREAKER.failures = 0;
    CIRCUIT_BREAKER.lastFailure = null;
  }
};

const incrementCircuitBreaker = () => {
  CIRCUIT_BREAKER.failures++;
  CIRCUIT_BREAKER.lastFailure = Date.now();
};

async function fetchWithRetry(url, options, retries = MAX_RETRIES, isRetry = false) {
  try {
    checkCircuitBreaker();

    if (isRetry) {
      log(`Retry attempt for URL: ${url}`);
    }
    
    log(`Making request to: ${url}`);
    const response = await fetch(url, options);
    log(`Response status: ${response.status} for URL: ${url}`);
    
    if (response.status === 530) {
      log('Received 530 status code - API may be temporarily unavailable');
      incrementCircuitBreaker();
      if (retries > 0) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
        log(`Waiting ${delay/1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retries - 1, true);
      }
      throw new Error('API_UNAVAILABLE');
    }

    if (response.status === 404) {
      throw new Error('PROFILE_NOT_FOUND');
    }

    if (response.status === 500) {
      throw new Error('INSTAGRAM_SERVER_ERROR');
    }
    
    if (!response.ok) {
      const responseClone = response.clone();
      const responseBody = await responseClone.text();
      log('Error response body:', responseBody);
      incrementCircuitBreaker();
      throw new Error(`HTTP_ERROR_${response.status}`);
    }
    
    CIRCUIT_BREAKER.failures = 0;
    CIRCUIT_BREAKER.lastFailure = null;
    
    return response;
  } catch (error) {
    log(`Fetch error for URL ${url}:`, error);
    if (retries > 0 && !error.message.startsWith('PROFILE_NOT_FOUND')) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
      log(`API call failed. Retrying in ${delay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, true);
    }
    throw error;
  }
}

async function fetchSocialStats(url) {
  let profileData = null;
  let reelsData = null;
  
  try {
    const hikerApiKey = process.env.HIKER_API_KEY;

    if (!hikerApiKey) {
      throw new Error('API_KEY_MISSING');
    }

    const apiUrl = `https://api.hikerapi.com/v1/user/by/url?url=${encodeURIComponent(url)}`;
    log('Fetching profile data...');
    
    const profileResponse = await fetchWithRetry(apiUrl, {
      headers: {
        'x-access-key': hikerApiKey,
        'accept': 'application/json'
      }
    });

    profileData = await profileResponse.json();
    log('Profile API response:', JSON.stringify(profileData, null, 2));

    if (!profileData || !profileData.pk) {
      throw new Error('INVALID_PROFILE_DATA');
    }

    const reelsUrl = `https://api.hikerapi.com/v1/user/clips?user_id=${profileData.pk}&amount=50`;
    log('Fetching reels data...');
    
    const reelsResponse = await fetchWithRetry(reelsUrl, {
      headers: {
        'x-access-key': hikerApiKey,
        'accept': 'application/json'
      }
    });

    reelsData = await reelsResponse.json();
    log('Reels API response:', JSON.stringify(reelsData, null, 2));

    if (!Array.isArray(reelsData)) {
      throw new Error('INVALID_REELS_DATA');
    }

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const postsLast30Days = reelsData.filter(post => {
      const postDate = new Date(post.taken_at).getTime();
      return postDate >= thirtyDaysAgo;
    });

    // Calculate total engagement for all posts in last 30 days
    const totalEngagement30Days = postsLast30Days.reduce((sum, post) => {
      return sum + post.like_count + post.comment_count + (post.share_count || 0) + (post.saves_count || 0);
    }, 0);

    // Calculate account ER for last 30 days
    const averageEngagementPer30DaysPost = postsLast30Days.length > 0 ? 
      totalEngagement30Days / postsLast30Days.length : 0;
    const accountER = (averageEngagementPer30DaysPost / profileData.follower_count) * 100;

    const reelsLast30Days = postsLast30Days.filter(post => post.media_type === 2);

    // Calculate Reels metrics for last 30 days
    const totalReelsEngagement30Days = reelsLast30Days.reduce((sum, reel) => {
      return sum + reel.like_count + reel.comment_count + (reel.share_count || 0) + (reel.saves_count || 0);
    }, 0);

    const totalReelsViews30Days = reelsLast30Days.reduce((sum, reel) => sum + reel.play_count, 0);
    
    const averageReelsEngagement30Days = reelsLast30Days.length > 0 ? 
      totalReelsEngagement30Days / reelsLast30Days.length : 0;
    
    const averageReelsViews30Days = reelsLast30Days.length > 0 ? 
      totalReelsViews30Days / reelsLast30Days.length : 0;

    const reelsER30Days = (averageReelsEngagement30Days / profileData.follower_count) * 100;
    const reelsERR30Days = averageReelsViews30Days > 0 ? 
      (averageReelsEngagement30Days / averageReelsViews30Days) * 100 : 0;

    // Get median views for Reels in last 30 days
    const viewCounts30Days = reelsLast30Days
      .map(reel => reel.play_count)
      .sort((a, b) => a - b);
    const medianViews30Days = viewCounts30Days.length > 0 ?
      viewCounts30Days[Math.floor(viewCounts30Days.length / 2)] : 0;

    // Calculate prediction coefficients
    const reelsCountCoef = reelsLast30Days.length >= 10 ? 1.2 : 0.8;

    const last5Reels = reelsData
      .filter(reel => reel.media_type === 2)
      .slice(0, 5);

    const medianViewsLast5 = [...last5Reels]
      .map(reel => reel.play_count)
      .sort((a, b) => a - b)[Math.floor(last5Reels.length / 2)] || 0;
    
    const viewsToFollowersCoef = medianViewsLast5 > profileData.follower_count * 2 ? 1.2 : 1;

    const last3Reels = reelsData
      .filter(reel => reel.media_type === 2)
      .slice(0, 3);

    const hasViralReel = last3Reels.some(reel => reel.play_count > medianViews30Days * 10);
    const viralCoef = hasViralReel ? 1.4 : 1;

    const predictedReach = medianViews30Days * reelsCountCoef * viewsToFollowersCoef * viralCoef;
    const predictedER = reelsER30Days * reelsCountCoef * viewsToFollowersCoef * viralCoef;
    const predictedERR = reelsERR30Days * reelsCountCoef * viewsToFollowersCoef * viralCoef;

    return {
      username: profileData.username,
      fullName: profileData.full_name,
      profileUrl: url,
      followers: profileData.follower_count,
      following: profileData.following_count,
      totalPosts: profileData.media_count,
      postsLast30Days: postsLast30Days.length,
      accountER,
      reelsLast30Days: reelsLast30Days.length,
      medianViews30Days,
      reelsER30Days,
      reelsERR30Days,
      predictedReach,
      predictedER,
      predictedERR
    };
  } catch (error) {
    log('Error fetching social stats:', error);
    log('Profile data at time of error:', profileData);
    log('Reels data at time of error:', reelsData);
    
    let errorMessage = 'Произошла ошибка при получении статистики. ';
    
    switch(error.message) {
      case 'API_KEY_MISSING':
        errorMessage = 'Ошибка конфигурации бота. Пожалуйста, обратитесь к администратору.';
        break;
      case 'PROFILE_NOT_FOUND':
        errorMessage = 'К сожалению, это закрытый аккаунт. Автор установил настройки в режиме «private». Мы не можем проанализировать данные.';
        break;
      case 'INSTAGRAM_SERVER_ERROR':
        errorMessage = 'Instagram временно недоступен. Пожалуйста, попробуйте через несколько минут.';
        break;
      case 'API_UNAVAILABLE':
        errorMessage = 'Сервис временно недоступен. Пожалуйста, попробуйте через несколько минут.';
        break;
      case 'INVALID_PROFILE_DATA':
        errorMessage = 'Не удалось получить данные профиля. Возможно, профиль закрыт или не существует.';
        break;
      case 'INVALID_REELS_DATA':
        errorMessage = 'Не удалось получить данные о Reels. Возможно, профиль закрыт или не содержит Reels.';
        break;
      default:
        errorMessage += 'Пожалуйста, попробуйте позже или обратитесь к автору бота.';
    }
    
    throw new Error(errorMessage);
  }
}

async function normalizeInstagramInput(input) {
  input = input.trim().toLowerCase();
  
  // Remove @ symbol if present
  input = input.replace(/^@/, '');
  
  // Check if it's already a URL
  if (input.includes('instagram.com')) {
    // Ensure https:// prefix
    if (!input.startsWith('http')) {
      input = 'https://' + input;
    }
    return input;
  }
  
  // Convert username to URL
  return `https://www.instagram.com/${input}`;
}
