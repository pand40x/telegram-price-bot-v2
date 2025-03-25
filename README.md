# Crypto Price Telegram Bot

A Telegram bot for getting cryptocurrency price information from CoinMarketCap.

## Features

- Fetch cryptocurrency prices from CoinMarketCap API
- Multiple API key pool with automatic fallback
- Get multiple cryptocurrency prices at once
- Formatted prices with percentage changes

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the root directory with the following variables:

```
# Telegram Bot Token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# CoinMarketCap API Keys (comma-separated)
CMC_API_KEYS=key1,key2,key3

# MongoDB Connection String
MONGODB_URI=mongodb://localhost:27017/crypto-price-bot
```

## Running the app

```bash
# development
npm run start:dev

# production mode
npm run start:prod
```

## Usage

- `/p [symbols]` - Get prices for given symbols (e.g. `/p btc eth pepe`)
- `/help` - Show available commands 