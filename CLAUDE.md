# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp-based monitoring bot for IPSP antennas and gateways (MonitoreoAntenasIPSP). Built with Node.js, this chatbot sends notifications about antenna/gateway status to designated WhatsApp numbers.

**Key Dependencies:**
- `@whiskeysockets/baileys` - WhatsApp Web API client
- `pino` / `pino-pretty` - Structured logging
- `qrcode-terminal` - QR code generation for WhatsApp authentication
- `express` - HTTP server framework

## Commands

### Running the Application
```bash
npm start                 # Start the monitoring bot (runs index.js)
```

### Development
```bash
npm install              # Install dependencies
```

**Note:** There are no test scripts configured in this project.

## Architecture

### Directory Structure
```
├── index.js                    # Main entry point (currently empty)
├── services/
│   └── WhatsAppService.js      # WhatsApp connection & messaging service
├── helpers/
│   └── direcciones.js          # Gateway/antenna IP addresses and sectors
├── utils/
│   └── logger.js               # Centralized Pino logger configuration
└── .env                        # Environment configuration
```

### Core Components

#### WhatsAppService (services/WhatsAppService.js)
Event-driven WhatsApp client wrapper extending EventEmitter. Manages connection lifecycle, QR authentication, and message sending.

**Key Methods:**
- `connect()` - Establishes WhatsApp connection, handles QR code display
- `sendMessage(to, message)` - Sends single message (assumes Ecuador +593 if no country code)
- `sendBroadcast(recipients, message)` - Sends to multiple recipients with 1-second delays
- `formatNumber(number)` - Converts phone numbers to WhatsApp JID format (`@s.whatsapp.net`)

**Events Emitted:**
- `ready` - Connection established
- `logout` - Session closed/logged out
- `message` - Incoming message received (non-self messages)
- `error` - Connection/operation error

**Authentication:** Uses multi-file auth state stored in `auth_info_baileys/` directory. If session is logged out, delete this directory and re-scan QR code.

**Connection Behavior:**
- Shows QR code in terminal (max 5 attempts before reset)
- Auto-reconnects on disconnection (unless logged out)
- Browser identifier: "Antenas IPSP" / Chrome / 1.0.0

#### Gateway/Antenna Configuration (helpers/direcciones.js)
Static mapping of gateways to IP addresses and sectors:
```javascript
{
  1: { IP: "192.169.116.1", Sectores: ["Garita", "Camaron", "Portillo"] },
  2: { IP: "192.168.120.1", Sectores: ["La Luz", "Taura 4", "Taura 5", "Taura 6"] }
}
```

#### Logger (utils/logger.js)
Pino logger with pretty-printing configured. Log level controlled by `LOG_LEVEL` env var (default: "info").

### Environment Variables (.env)

```bash
WHATSAPP_NUMBERS=593984778678           # Comma-separated recipient numbers (no + prefix)
MONITOR_INTERVAL=60000                  # Monitoring interval in milliseconds (60s)
MAX_ERROR_COUNT=5                       # Max consecutive errors before marking offline
```

## Important Notes

- **ES Modules:** This project uses ES modules (`import`/`export`), not CommonJS
- **Phone Number Format:** All phone numbers in international format WITHOUT the `+` sign (e.g., `593912345678`)
- **WhatsApp Auth:** If WhatsApp disconnects due to logout, manually delete `auth_info_baileys/` directory
- **Empty Entry Point:** `index.js` is currently empty and needs implementation of the monitoring logic
- **No Git Repo:** This directory is not currently a git repository
- **Ecuador-Centric:** Phone number formatter defaults to Ecuador country code (+593) for 9-digit numbers

## Typical Implementation Pattern

The main monitoring loop (to be implemented in index.js) should:
1. Initialize WhatsAppService and wait for 'ready' event
2. Set up periodic monitoring using `MONITOR_INTERVAL`
3. Ping/check each gateway IP from `direcciones.js`
4. Track consecutive error counts per gateway
5. Send WhatsApp alerts when status changes or `MAX_ERROR_COUNT` exceeded
6. Use the centralized logger for all logging operations
