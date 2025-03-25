# Smart Correction System with MongoDB Integration

This module implements a smart symbol resolution system with persistent storage using MongoDB.

## Features

1. **Smart Symbol Resolution**
   - Exact matching
   - Name/alias matching
   - Fuzzy matching
   - User preference-based ranking

2. **MongoDB Persistent Storage**
   - User preferences collection: Stores user search history and query preferences
   - Symbol database collection: Stores the available symbols with metadata

## Technical Implementation

### MongoDB Schema

The system uses two collections:

1. **UserPreference**
   - `userId`: User's unique identifier
   - `stockSearches`: Count of stock searches by user
   - `cryptoSearches`: Count of crypto searches by user
   - `queryPreferences`: Map of normalized queries to selected symbols

2. **SymbolData**
   - `symbol`: Unique symbol identifier
   - `type`: Type of the symbol ('stock' or 'crypto')
   - `name`: Full name of the asset
   - `aliases`: Alternative names or identifiers
   - `popularity`: Ranking score (1-100)

### Caching Strategy

The system uses in-memory caching to improve performance:
- Symbol database and user preferences are loaded from MongoDB on application startup
- Write operations update both the in-memory cache and MongoDB
- Read operations prioritize in-memory cache for fast lookups

### Smart Correction

The system employs several strategies to correct user queries:
1. User-specific correction based on previous selections
2. Type-preference based on user history
3. Prefix-based forcing ($ for stocks, # or @ for crypto)
4. Multi-stage matching (exact, name, fuzzy)

## Usage

User search behavior improves over time as the system learns preferences from user interactions. When a user selects a specific asset from multiple options, the system remembers this preference for future queries. 