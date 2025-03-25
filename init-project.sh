#!/bin/bash

# Install dependencies
echo "Installing dependencies..."
npm install

# Create src directories if they don't exist
mkdir -p src/bot
mkdir -p src/cmc/schemas

echo "Project initialized successfully!"
echo "Please update your .env file with your Telegram bot token, CoinMarketCap API keys, and MongoDB URI."
echo "Then run 'npm run start:dev' to start the bot in development mode." 