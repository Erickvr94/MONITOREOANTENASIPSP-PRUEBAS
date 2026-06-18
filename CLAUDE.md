# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monitoring bot for IPSP antennas and gateways (Melacorp S.A, Ecuador). Periodically pings gateway IPs (ICMP) and polls AP/PTP devices via SNMP, tracks status changes, broadcasts real-time status to WebSocket subscribers, and persists state snapshots to MongoDB. Includes a REST API for historical data queries.

## Commands

```bash
npm start       # Start the monitoring bot (node index.js)
npm install     # Install dependencies
```

No test framework, linter, or build step is configured. The app runs directly with Node.js (ES Modules).

## Architecture

**ES Modules** (`"type": "module"` in package.json) — use `import`/`export`, not `require`.

### Startup Flow (`index.js`)

1. Reads `config/fincas.js` to get the list of active fincas
2. For each finca: dynamically imports its `config/fincas/<id>/direcciones.js` and `ap_ptp.js`, then creates a dedicated MongoDB connection (`MONGO_HOST/<finca.db>`) and a Mongoose model on that connection
3. Creates `WebSocketService` (Express + ws sharing one HTTP server), mounts historial routes at `/api/ipsp/:finca/historial`
4. Starts **two parallel monitoring loops per finca** immediately, then on intervals:
   - **Ping loop** (`MONITOR_INTERVAL`): sequential per-gateway, `MAX_ERROR_COUNT` verification rounds of 5 ICMP pings each, majority vote determines state. Extra verification round if result is offline. Broadcasts `gateway_update` per gateway + `estado_completo` at end of cycle. Saves snapshot to finca's MongoDB.
   - **SNMP loop** (`SNMP_INTERVAL`): parallel polling of all AP/PTP devices via `net-snmp` subtree query. Broadcasts `estado_completo` + saves snapshot at end of cycle.
5. WebSocket clients subscribe to a finca by sending `{ accion: "suscribir", finca: "<id>" }` after connecting; server then sends `estado_completo` for that finca and routes all future events to that client only.

### Key Files

- **`index.js`** — Entry point. Per-finca monitoring loops, ping logic (`ejecutarPing`, `verificarEstadoIP`), SNMP orchestration. In-memory state lives in `monitores[fincaId].estado` (`gateways`, `detalleGateways`, `dispositivos`, `detalleDispositivos`, `erroresConsecutivos`). WebSocket broadcasting via `broadcastToFinca`. MongoDB persistence via `broadcastYGuardar(fincaId)`.
- **`services/WebSocketService.js`** — Express app + ws server sharing one `http.Server` (EventEmitter). Listens only on `127.0.0.1`. All `/api` routes require `x-internal-token` header. WebSocket connections also require `x-internal-token`. Exposes `use(path, router)`, `broadcastToFinca(finca, data)`, `sendToClient(ws, data)`. Emits `client_subscribed` when a client sends `{ accion: "suscribir", finca }`.
- **`services/SNMPService.js`** — `consultarSNMP(ip, oid)` uses SNMP v1 subtree query; returns `{ online, value?, count, error? }` where `count` is the number of varbinds received and `value` is the first numeric result
- **`config/fincas.js`** — Central registry of active fincas: `{ [fincaId]: { nombre } }`. Add/remove fincas here; the service loads all listed fincas at startup.
- **`config/database.js`** — `connectDatabase()`: creates and returns a single shared Mongoose connection to `MONGODB_URI`
- **`models/EstadoHistorico.js`** — `crearModeloEstadoHistorico(connection, fincaId)`: returns a Mongoose model bound to collection `<fincaId>_estados_historicos`. Schema: `{ timestamp, gateways (Mixed), dispositivos (Mixed) }` with 90-day TTL. All fincas share the same `monitoreo` database, separated by collection.
- **`middleware/authMiddleware.js`** — `requireInternalToken`: checks `x-internal-token` header against `INTERNAL_TOKEN` env var
- **`routes/historial.js`** — Historical data endpoints with `{ mergeParams: true }`. Gets the correct Mongoose model from `req.app.locals.modelosPorFinca[finca]`.
- **`config/fincas/<finca_id>/direcciones.js`** — Gateway config for ping monitoring: `{ id: { IP, Sectores[] } }`
- **`config/fincas/<finca_id>/ap_ptp.js`** — AP/PTP device config for SNMP monitoring: `{ grupo: { nombre: { IP, Ubicacion, OID } } }`. Ubiquiti devices use OID `1.3.6.1.4.1.41112.1.4.7.1.3.1`
- **`utils/logger.js`** — Pino logger with pretty-print; level from `LOG_LEVEL` env var

### Authentication

All REST API calls and WebSocket connections require the `x-internal-token` header matching the `INTERNAL_TOKEN` env var. There is no JWT or user management system.

### WebSocket Message Types

- `estado_completo` — Full snapshot of all gateways + dispositivos for the subscribed finca. Sent after subscription and after each full cycle. Includes `finca` field.
- `gateway_update` — Single gateway result after each ping check. Includes `finca` field. Only sent to clients subscribed to that finca.
- `error` — Sent if the client subscribes to a finca that doesn't exist.

### REST API Endpoints

All endpoints require `x-internal-token` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ipsp/:finca/historial/ultima-hora` | State snapshots from last hour |
| GET | `/api/ipsp/:finca/historial/fecha/:fecha` | State snapshots for a date (YYYY-MM-DD, Ecuador TZ) |
| GET | `/api/ipsp/:finca/historial/caidas/:fecha` | Downtime counts and % per gateway/device for a date |
| GET | `/api/ipsp/:finca/historial/caidas/:fechaInicio/:fechaFin` | Downtime breakdown per day across a date range |

## Environment Variables (.env)

| Variable | Default | Description |
|---|---|---|
| `INTERNAL_TOKEN` | (none) | Shared secret for WebSocket and REST API access |
| `MONGODB_URI` | `mongodb://localhost:27017/monitoreo` | MongoDB connection string. Una sola BD `monitoreo`; cada finca usa su propia colección `<fincaId>_estados_historicos` |
| `MONITOR_INTERVAL` | `60000` | Ping cycle interval in ms |
| `MAX_ERROR_COUNT` | `5` | Number of verification rounds per gateway per cycle |
| `SNMP_INTERVAL` | `30000` | SNMP poll interval in ms |
| `SNMP_COMMUNITY` | `public` | SNMP community string |
| `SNMP_TIMEOUT` | `5000` | SNMP request timeout in ms |
| `SNMP_RETRIES` | `4` | SNMP retries on timeout |
| `WS_PORT` | `3000` | WebSocket/HTTP server port (binds to 127.0.0.1 only) |
| `LOG_LEVEL` | `info` | Pino log level |

## Important Notes

- Ping uses the `ping` npm package (`ping.promise.probe`) with `-n 1` flag (Windows-style) — this runs on Windows
- `verificarEstadoIP` runs `MAX_ERROR_COUNT` rounds of 5 pings each; majority vote determines state. An extra verification round runs if the result is offline (to catch recovery)
- Ping success threshold: fewer than 3 lost packets out of 5 = online; majority of rounds must pass
- `erroresConsecutivosDispositivos[key]` increments on each consecutive SNMP failure and resets to 0 on recovery
- `detalleGateways[id]` stores `{ ultimoPing, ultimaActualizacion }` for the WebSocket `gateway_update` payload
- `detalleDispositivos[key]` stores `{ uptime: null, error, ultimaActualizacion }` (`uptime` is always `null`)
- **SNMP broadcast order**: `broadcastYGuardar()` is called before anything else at the end of each SNMP cycle
- The historial date endpoints interpret dates as Ecuador local time (UTC-5, `America/Guayaquil`)
- MongoDB must be running before starting the app (connection failure is fatal)
- SNMP queries use v1 protocol (not v2c) with subtree method
- **Multi-finca**: one service monitors all fincas simultaneously. To add a finca: (1) add an entry to `config/fincas.js`, (2) create `config/fincas/<id>/direcciones.js` and `ap_ptp.js`, (3) restart the service.
- To add a gateway to an existing finca: edit `config/fincas/<finca_id>/direcciones.js`. To add AP/PTP devices: edit `config/fincas/<finca_id>/ap_ptp.js`.
- WebSocket clients must send `{ accion: "suscribir", finca: "<id>" }` after connecting to start receiving events.
