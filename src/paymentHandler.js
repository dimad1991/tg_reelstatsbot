import debug from 'debug';
import express from 'express';
import bodyParser from 'body-parser';

const log = debug('telegram-bot:payment-handler');

class PaymentHandler {
  constructor(paymentManager, userManager, bot) {
    this.paymentManager = paymentManager;
    this.userManager = userManager;
    this.bot = bot;
    this.app = express();
    this.port = process.env.PAYMENT_HANDLER_PORT || 3001;
    
    this.setupServer();
  }

  setupServer() {
    this.app.use(bodyParser.json());
    
    // Payment notification endpoint
    this.app.post('/payment/notification', async (req, res) => {
      try {
        log('Received payment notification:', req.body);
        
        // Process payment notification
        const result = await this.paymentManager.handlePaymentNotification(req.body);
        
        if (!result.success) {
          log('Failed to process payment notification:', result.error);
          return res.status(400).send('ERROR');
        }
        
        // If payment is confirmed, assign tariff to user
        if (result.paymentData.status === 'CONFIRMED') {
          const { userId, tariffCode } = result.paymentData;
          
          const tariffResult = await this.userManager.assignTariff(
            userId,
            tariffCode,
            result.paymentData.paymentId
          );
          
          if (tariffResult.success) {
            // Notify user about successful payment
            try {
              await this.bot.sendMessage(
                userId,
                `✅ Оплата успешно прошла!\n\nТариф "${tariffCode}" активирован. Теперь вы можете продолжить использование бота.`
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
    this.app.get('/payment/success', (req, res) => {
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
              <a href="https://t.me/your_bot_username" class="btn">Вернуться к боту</a>
            </div>
          </body>
        </html>
      `);
    });
    
    // Payment failure endpoint
    this.app.get('/payment/fail', (req, res) => {
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
              <a href="https://t.me/your_bot_username" class="btn">Вернуться к боту</a>
            </div>
          </body>
        </html>
      `);
    });
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`Payment handler server running on port ${this.port}`);
      log(`Payment handler server running on port ${this.port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

export default PaymentHandler;
