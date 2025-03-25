#!/bin/bash

if [ ! -f ".env" ]; then
  echo "Error: .env file not found!"
  echo "Please create a .env file with your configuration first."
  exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting crypto price bot..."
npm run start:dev 