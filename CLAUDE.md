# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp-based monitoring bot for IPSP antennas and gateways (Melacorp S.A, Ecuador). Periodically pings gateway IPs (ICMP) and polls AP/PTP devices via SNMP, tracks status changes, sends WhatsApp alerts on connectivity changes, broadcasts real-time status to WebSocket subscribers, and persists state snapshots to MongoDB. Includes a REST API with JWT auth for user management and historical data queries.

## Commands

```bash
npm start       # Start the monitoring bot (node index.js)
npm install     # Install dependencies
```

No test framework, linter, or build step is configured. The app runs directly with Node.js (ES Modules).

## Architecture

**ES Modules** (`"type": "module"` in package.json) -- use `import`/`export`, not `require`.

### Startup Flow (`index.js`)

1. Connects to MongoDB via Mongoose (`config/database.js`)
2. Creates `WebSocketService` (Express + ws on same HTTP server), mounts REST API routes
3. Starts WhatsApp connection in background (non-blocking -- monitoring begins even if WhatsApp isn't ready)
4. Runs two parallel monitoring loops immediately, then on intervals:
   - **Ping loop** (`MONITOR_INTERVAL`): sequential per-gateway, `MAX_ERROR_COUNT` verification rounds of 5 ICMP pings each, majority vote determines state. Extra verification round if result is offline. WhatsApp alerts on state changes. Broadcasts `gateway_update` per gateway + `estado_completo` at end of cycle. Saves snapshot to MongoDB.
   - **SNMP loop** (`SNMP_INTERVAL`): parallel polling of all AP/PTP devices via `net-snmp` subtree query. Broadcasts `estado_completo` + saves snapshot at end of cycle.
5. New WebSocket clients immediately receive full state on connect.

### Key Files

- **`index.js`** -- Entry point. Monitoring loops, ping logic, SNMP orchestration, WhatsApp alert formatting, in-memory state tracking (`estadoGateways`, `estadoDispositivos`), WebSocket broadcasting, MongoDB persistence via `broadcastYGuardar()`
- **`services/WhatsAppService.js`** -- Baileys-based WhatsApp client (EventEmitter). QR auth via terminal, auto-reconnection on non-logout disconnects. Auth state in `auth_info_baileys/`. Emits `ready`, `logout`, `message`
- **`services/WebSocketService.js`** -- Express app + ws server sharing one `http.Server` (EventEmitter). Exposes `use(path, router)` to mount Express routes, `broadcast(data)`, `sendToClient(ws, data)`. CORS configured for localhost and 192.168.148.x subnet. Emits `client_connected`
- **`services/SNMPService.js`** -- `consultarSNMP(ip, oid)` uses SNMP v1 subtree query; returns `{ online, value?, error? }`
- **`config/database.js`** -- Mongoose connection to MongoDB (`MONGODB_URI` env var)
- **`models/EstadoHistorico.js`** -- Mongoose model `IPSPEstadosHistorico`: `{ timestamp, gateways (Mixed), dispositivos (Mixed) }`. Stores full state snapshots each monitoring cycle
- **`models/User.js`** -- Mongoose model: `{ username, email, name, password (bcrypt), role (master|admin|user) }`
- **`middleware/authMiddleware.js`** -- `requireAuth` (JWT Bearer verification), `requireRole(...roles)` (role-based access)
- **`routes/auth.js`** -- `POST /api/auth/login` (username or email + password → JWT), `GET /api/auth/me` (current user profile)
- **`routes/users.js`** -- `POST /api/users` (create user, master role only)
- **`routes/historial.js`** -- `GET /api/historial/ultima-hora` (last hour snapshots), `GET /api/historial/fecha/:fecha` (YYYY-MM-DD, Ecuador UTC-5)
- **`helpers/direcciones.js`** -- Gateway config for ping monitoring: `{ id: { IP, Sectores[] } }`
- **`helpers/ap_ptp.js`** -- AP/PTP device config for SNMP monitoring: `{ grupo: { nombre: { IP, Ubicacion, OID } } }`. Ubiquiti devices using OID `1.3.6.1.4.1.41112.1.4.7.1.3.1`
- **`utils/logger.js`** -- Pino logger with pretty-print; level from `LOG_LEVEL` env var

### WebSocket Message Types

- `estado_completo` -- Full snapshot of all gateways + dispositivos (sent on connect and after each full cycle)
- `gateway_update` -- Single gateway result after each ping check

### REST API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Login with username/email + password, returns JWT |
| GET | `/api/auth/me` | Bearer JWT | Get current user profile |
| POST | `/api/users` | Bearer JWT (master) | Create new user |
| GET | `/api/historial/ultima-hora` | None | State snapshots from last hour |
| GET | `/api/historial/fecha/:fecha` | None | State snapshots for a date (YYYY-MM-DD, Ecuador TZ) |

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
| `MONGODB_URI` | `mongodb://localhost:27017/monitoreo` | MongoDB connection string |
| `JWT_SECRET` | `changeme` | Secret for signing JWT tokens |
| `JWT_EXPIRES_IN` | `8h` | JWT token expiration |

## Important Notes

- Phone numbers use international format WITHOUT `+` sign. 9-digit numbers auto-prefixed with `593` (Ecuador)
- If WhatsApp session is logged out, delete `auth_info_baileys/` directory and re-scan QR
- Ping uses `-n 1` flag (Windows-style) -- this runs on Windows
- WhatsApp broadcast adds 1-second delay between recipients to avoid rate limits
- WhatsApp connection is non-blocking: monitoring and WebSocket start even if WhatsApp is still connecting
- MongoDB must be running before starting the app (connection failure is fatal)
- SNMP queries use v1 protocol (not v2c) with subtree method
- All dates displayed in WhatsApp messages use Ecuador timezone (`America/Guayaquil`)
- The historial date endpoint interprets dates as Ecuador local time (UTC-5)
