import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import debug from 'debug';
import http from 'node:http';

const log = debug('telegram-bot');
dotenv.config();

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

// Initialize bot with polling disabled initially
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false
});

// Explicitly bind to PORT from environment or fallback to 3000
const PORT = process.env.PORT || 3000;

// Start server and bot
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server is running on port ${PORT}`);
  log(`Server is running on port ${PORT}`);
  
  try {
    // Start bot polling after server is running
    await bot.startPolling();
    console.log('Bot polling started successfully');
    log('Bot polling started successfully');
    
    // Set up message handlers
    setupMessageHandlers(bot);
    
    console.log('Bot and server are both running');
    log('Bot and server are both running');
  } catch (error) {
    console.error('Failed to start bot polling:', error);
    log('Failed to start bot polling:', error);
    process.exit(1);
  }
});

// Error handling for server
server.on('error', (error) => {
  console.error('Server error:', error);
  log('Server error:', error);
  process.exit(1);
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

    const reelsLast30Days = postsLast30Days.filter(post => post.media_type === 2);

    const last9Reels = reelsData
      .filter(reel => reel.media_type === 2)
      .slice(0, 9);

    const viewCounts = last9Reels.map(reel => reel.play_count).sort((a, b) => a - b);
    const medianViews = viewCounts.length > 0
      ? viewCounts[Math.floor(viewCounts.length / 2)]
      : 0;

    const totalEngagement9Reels = last9Reels.reduce((sum, reel) => {
      return sum + reel.like_count + reel.comment_count + (reel.share_count || 0) + (reel.saves_count || 0);
    }, 0);
    const averageEngagementPer9Reels = last9Reels.length > 0 ? totalEngagement9Reels / 9 : 0;
    const er = (averageEngagementPer9Reels / profileData.follower_count) * 100;

    const totalViews9Reels = last9Reels.reduce((sum, reel) => sum + reel.play_count, 0);
    const err = totalViews9Reels > 0 ? (totalEngagement9Reels / totalViews9Reels) * 100 : 0;

    const reelsCountCoef = reelsLast30Days.length >= 10 ? 1.2 : 0.8;

    const last5Reels = reelsData
      .filter(reel => reel.media_type === 2)
      .slice(0, 5);

    const avgViewsLast5 = last5Reels.reduce((sum, reel) => sum + reel.play_count, 0) / 5;
    const viewsToFollowersCoef = avgViewsLast5 > profileData.follower_count * 2 ? 1.2 : 1;

    const hasViralReel = last5Reels.some(reel => reel.play_count > medianViews * 10);
    const viralCoef = hasViralReel ? 1.2 : 1;

    const predictedReach = medianViews * reelsCountCoef * viewsToFollowersCoef * viralCoef;

    let baseER = er;
    if (baseER === 0 && reelsData.length >= 3) {
      const last3Reels = reelsData
        .filter(reel => reel.media_type === 2)
        .slice(0, 3);
      const totalEngagement3Reels = last3Reels.reduce((sum, reel) => {
        return sum + reel.like_count + reel.comment_count + (reel.share_count || 0) + (reel.saves_count || 0);
      }, 0);
      baseER = (totalEngagement3Reels / 3 / profileData.follower_count) * 100;
    }
    const predictedER = baseER * reelsCountCoef * viewsToFollowersCoef * viralCoef;

    let baseERR = err;
    if (baseERR === 0 && reelsData.length >= 3) {
      const last3Reels = reelsData
        .filter(reel => reel.media_type === 2)
        .slice(0, 3);
      const totalEngagement3Reels = last3Reels.reduce((sum, reel) => {
        return sum + reel.like_count + reel.comment_count + (reel.share_count || 0) + (reel.saves_count || 0);
      }, 0);
      const totalViews3Reels = last3Reels.reduce((sum, reel) => sum + reel.play_count, 0);
      baseERR = totalViews3Reels > 0 ? (totalEngagement3Reels / totalViews3Reels) * 100 : 0;
    }
    const predictedERR = baseERR * reelsCountCoef * viewsToFollowersCoef * viralCoef;

    return {
      username: profileData.username,
      fullName: profileData.full_name,
      profileUrl: url,
      followers: profileData.follower_count,
      following: profileData.following_count,
      totalPosts: profileData.media_count,
      postsLast30Days: postsLast30Days.length,
      reelsLast30Days: reelsLast30Days.length,
      medianViews,
      er,
      err,
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
        errorMessage = 'Профиль не найден. Проверьте правильность ссылки или username.';
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

function setupMessageHandlers(bot) {
  bot.onText(/\/start/, async (msg) => {
    try {
      log('Received /start command from:', msg.chat.id);
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

  bot.on('callback_query', async (query) => {
    try {
      const chatId = query.message.chat.id;

      if (query.data === 'forecast_info') {
        await bot.sendMessage(chatId, FORECAST_INFO);
      } else if (query.data === 'contact_author') {
        await bot.sendMessage(chatId, AUTHOR_INFO);
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
      let url = msg.text.trim();
      
      if (url.startsWith('@') || !url.includes('/')) {
        url = await normalizeInstagramInput(url);
      }
      
      const isValidUrl = url.toLowerCase().includes('instagram.com') || url.toLowerCase().includes('tiktok.com');
      if (!isValidUrl) {
        await bot.sendMessage(msg.chat.id, 'Чтобы получить статистику по нужному вам профилю, *отправьте 🔗 ссылку* или *username* на аккаунт в бот.', { parse_mode: 'Markdown' });
        return;
      }

      await bot.sendMessage(msg.chat.id, 'Работаю ⚙️ Не уходите из чата, это займет меньше минуты.');

      const stats = await fetchSocialStats(url);
      
      const escapedFullName = stats.fullName.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      
      const response = `*Имя:* ${escapedFullName}
—————————————————

*📊 Статистика аккаунта:*

• Подписчиков — ${stats.followers.toLocaleString()}
• Подписок — ${stats.following.toLocaleString()}
• Всего публикаций — ${stats.totalPosts.toLocaleString()}
• Публикаций за последний месяц — ${stats.postsLast30Days.toLocaleString()}
—————————————————

*👁️ Статистика Reels:*

• Reels за последний месяц — ${stats.reelsLast30Days.toLocaleString()}
• Медиана просмотров Reels — ${stats.medianViews.toLocaleString()}
• ER Reels — ${stats.er.toFixed(2)}%
• ERR Reels — ${stats.err.toFixed(2)}%
—————————————————

*📈 Прогноз Reels:*

• Охват — ${Math.round(stats.predictedReach).toLocaleString()}
• ER — ${stats.predictedER.toFixed(2)}%
• ERR — ${stats.predictedERR.toFixed(2)}%
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
      log('Error processing message:', error);
      await bot.sendMessage(msg.chat.id, error.message);
    }
  });
}
