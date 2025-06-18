# Telegram Bot with Monetization

This project is a Telegram bot that provides Instagram profile statistics with a monetization system based on tariff plans.

## Features

- Instagram profile statistics analysis
- Tariff-based monetization system
- Payment integration with Т-Банк (Tinkoff Bank)
- User management with tariff tracking
- Google Sheets analytics integration

## Tariff Plans

The bot offers several tariff plans:

- **Test**: 5 free checks (default for new users)
- **S**: 100 checks for 1,190 rubles/month (31 days)
- **M**: 300 checks for 2,970 rubles/month (31 days)
- **Free**: Unlimited checks (special/admin assigned)

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   cp .env.example .env
   ```
4. Start the bot:
   ```
   npm run bot
   ```

## Environment Variables

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
- `HIKER_API_KEY`: API key for HikerAPI (Instagram data)
- `DEBUG`: Debug namespaces (telegram-bot*)
- `PORT`: Port for the HTTP server
- `ADMIN_USER_ID`: Telegram user ID of the admin
- `GOOGLE_SPREADSHEET_ID`: ID of your Google Spreadsheet for analytics
- `GOOGLE_SERVICE_ACCOUNT_KEY`: JSON key for Google Service Account
- `TBANK_TERMINAL_KEY`: Tinkoff Bank terminal key
- `TBANK_TERMINAL_PASSWORD`: Tinkoff Bank terminal password
- `TBANK_MERCHANT_ID`: Tinkoff Bank merchant ID
- `PAYMENT_HANDLER_PORT`: Port for payment handler server
- `PAYMENT_NOTIFICATION_URL`: URL for payment notifications
- `PAYMENT_SUCCESS_URL`: URL for successful payments
- `PAYMENT_FAIL_URL`: URL for failed payments

## Google Sheets Structure

The bot uses Google Sheets for analytics with the following structure:

- **Messages**: Tracks all messages sent to the bot
- **Profile Requests**: Tracks all profile analysis requests
- **User Statistics**: Tracks user data including tariff information
- **Summary**: Provides summary statistics
- **Payments**: Tracks all payment transactions

## Payment Integration

The bot integrates with Tinkoff Bank for payments. When a user reaches their limit, they are prompted to purchase a tariff plan. After successful payment, the tariff is automatically activated.

## Admin Commands

- `/tariff`: Shows current tariff information
- `/admin_set_tariff [user_id] [tariff_code]`: Allows admins to manually set a user's tariff

## License

This project is licensed under the MIT License.
