# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp-based monitoring bot for IPSP antennas and gateways. Periodically pings gateway IPs (ICMP) and polls AP/PTP devices via SNMP, tracks status changes, sends WhatsApp alerts on connectivity changes, and broadcasts real-time status to WebSocket subscribers. Ecuador-centric (Taura sector gateways, +593 phone numbers).

## Commands

```bash
npm start       # Start the monitoring bot (node index.js)
npm install     # Install dependencies
```

No test framework is configured.

## Architecture

**ES Modules** (`"type": "module"` in package.json) -- use `import`/`export`, not `require`.

### Flow

`index.js` (entry point) orchestrates two parallel monitoring loops:
1. Starts `WebSocketService` (Express + ws) on `WS_PORT`
2. Connects to WhatsApp via `WhatsAppService`, waits for `ready` event
3. **Ping loop** (`MONITOR_INTERVAL`): for each gateway in `direcciones.js`, runs `MAX_ERROR_COUNT` verification rounds with 5 ICMP pings each. Majority vote determines state. Sends WhatsApp alerts on state changes. Broadcasts `gateway_update` + `estado_completo` via WebSocket.
4. **SNMP loop** (`SNMP_INTERVAL`): polls all AP/PTP devices in `ap_ptp.js` in parallel via `net-snmp` (sysUpTime OID). Broadcasts `estado_completo` via WebSocket.
5. New WebSocket clients immediately receive full state (`estado_completo`).

### Key Files

- **`index.js`** -- Monitoring loops, ping logic, SNMP orchestration, alert messages, state tracking, WebSocket broadcasting
- **`services/WhatsAppService.js`** -- Baileys-based WhatsApp client (EventEmitter). Handles QR auth, reconnection, message sending. Auth state stored in `auth_info_baileys/` directory
- **`services/WebSocketService.js`** -- Express + ws server (EventEmitter). Manages WebSocket clients, `broadcast()`, `sendToClient()`. Emits `client_connected`.
- **`services/SNMPService.js`** -- `consultarSNMP(ip)` wraps net-snmp sysUpTime query; returns `{ online, uptime?, error? }`
- **`helpers/direcciones.js`** -- Gateway config for ping monitoring: `{ id: { IP, Sectores[] } }`
- **`helpers/ap_ptp.js`** -- AP/PTP device config for SNMP monitoring: `{ grupo: { nombre: { IP, Ubicacion } } }`
- **`utils/logger.js`** -- Pino logger with pretty-print; level from `LOG_LEVEL` env var

### WebSocket Message Types

- `estado_completo` -- Full snapshot of all gateways + dispositivos (sent on connect and after each full cycle)
- `gateway_update` -- Single gateway result after each ping check

### Key Dependencies

- `@whiskeysockets/baileys` -- WhatsApp Web API
- `ping` -- Cross-platform ICMP ping
- `net-snmp` -- SNMP v2c queries
- `ws` -- WebSocket server
- `express` -- HTTP server (shared with WebSocket)
- `pino` / `pino-pretty` -- Logging
- `dotenv` -- Environment config

## Environment Variables (.env)

| Variable | Default | Description |
|---|---|---|
| `WHATSAPP_NUMBERS` | (none) | Comma-separated recipient numbers (no `+` prefix, e.g. `593984778678`) |
| `MONITOR_INTERVAL` | `60000` | Ping cycle interval in ms |
| `MAX_ERROR_COUNT` | `5` | Number of verification rounds per gateway per cycle |
| `SNMP_INTERVAL` | `30000` | SNMP poll interval in ms |
| `SNMP_COMMUNITY` | `public` | SNMP community string |
| `SNMP_TIMEOUT` | `5000` | SNMP request timeout in ms |
| `SNMP_RETRIES` | `1` | SNMP retries on timeout |
| `WS_PORT` | `3000` | WebSocket/HTTP server port |
| `LOG_LEVEL` | `info` | Pino log level |

## Important Notes

- Phone numbers use international format WITHOUT `+` sign. 9-digit numbers auto-prefixed with `593` (Ecuador)
- If WhatsApp session is logged out, delete `auth_info_baileys/` directory and re-scan QR
- Ping uses `-n 1` flag (Windows-style) -- this runs on Windows
- WhatsApp broadcast adds 1-second delay between recipients to avoid rate limits
