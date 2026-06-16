# Sistema de Monitoreo de Antenas y Gateways IPSP

Sistema automatizado de monitoreo de conectividad para antenas y gateways de IPSP (Melacorp S.A, Ecuador). Combina ping ICMP para gateways y polling SNMP para dispositivos AP/PTP, con alertas en tiempo real por WhatsApp, streaming WebSocket y persistencia en MongoDB.

## Características

- **Monitoreo por ping**: Verificación ICMP secuencial de gateways con sistema de múltiples rondas para evitar falsos positivos
- **Monitoreo SNMP**: Polling paralelo de dispositivos Ubiquiti AP/PTP vía SNMP v1
- **Alertas WhatsApp**: Notificaciones automáticas al cambiar el estado de cualquier dispositivo
- **Supresión inteligente de alertas**: Las alertas SNMP se suprimen si el gateway del sector también está caído
- **WebSocket en tiempo real**: Clientes conectados reciben `estado_completo` y `gateway_update` inmediatamente
- **API REST con JWT**: Endpoints para autenticación, gestión de usuarios e historial
- **Historial en MongoDB**: Snapshots del estado completo tras cada ciclo de monitoreo
- **Logging estructurado**: Pino con pretty-print configurable por nivel

## Requisitos

- Node.js v18 o superior
- MongoDB (debe estar corriendo antes de iniciar la app)
- Cuenta de WhatsApp activa
- Conectividad de red hacia los gateways y dispositivos monitoreados

## Instalación

```bash
git clone <url>
cd MonitoreoAntenasIPSP
npm install
```

Crea un archivo `.env` en la raíz (ver sección de variables de entorno).

## Uso

```bash
npm start
```

En la primera ejecución se muestra un código QR en la terminal. Escanéalo con WhatsApp para vincular la sesión. Una vez conectado, el monitoreo inicia de inmediato (no espera a WhatsApp).

Para detener: `Ctrl + C`

## Variables de Entorno (.env)

| Variable | Default | Descripción |
|---|---|---|
| `WHATSAPP_NUMBERS` | (none) | Números separados por coma, sin `+` (ej: `593984778678`) |
| `MONITOR_INTERVAL` | `60000` | Intervalo ciclo ping en ms |
| `MAX_ERROR_COUNT` | `5` | Rondas de verificación por gateway por ciclo |
| `SNMP_INTERVAL` | `30000` | Intervalo ciclo SNMP en ms |
| `SNMP_COMMUNITY` | `public` | Comunidad SNMP |
| `SNMP_TIMEOUT` | `5000` | Timeout SNMP en ms |
| `SNMP_RETRIES` | `4` | Reintentos SNMP en timeout |
| `WS_PORT` | `3000` | Puerto HTTP/WebSocket |
| `LOG_LEVEL` | `info` | Nivel de log Pino (`debug`, `info`, `warn`, `error`) |
| `MONGODB_URI` | `mongodb://localhost:27017/monitoreo` | URI de conexión MongoDB |
| `JWT_SECRET` | `changeme` | Secreto para firmar JWT |
| `JWT_EXPIRES_IN` | `8h` | Expiración de tokens JWT |

## Configuración de Dispositivos

### Gateways (ping) — `helpers/direcciones.js`

```js
export const direcciones = {
  1: { IP: "192.168.116.1", Sectores: ["Garita", "Camaron", "Portillo"] },
  2: { IP: "192.168.120.1", Sectores: ["La Luz", "Taura 4", "Taura 5", "Taura 6"] },
};
```

### Dispositivos AP/PTP (SNMP) — `helpers/ap_ptp.js`

```js
export const direccionesIP = {
  "Nombre Sector": {
    "NombreDispositivo": { IP: "x.x.x.x", Ubicacion: "...", OID: "1.3.6.1.4.1.41112..." },
  },
};
```

El sector del dispositivo debe coincidir con un valor en `Sectores[]` del gateway correspondiente para que la supresión de alertas funcione correctamente.

## Cómo Funciona

### Ciclo de Ping (gateways)

Por cada gateway:
1. Ejecuta `MAX_ERROR_COUNT` rondas de 5 pings ICMP
2. Cada ronda: si se pierden < 3 paquetes → ronda exitosa
3. Si la mayoría de rondas son exitosas → **CON COMUNICACIÓN**
4. Si el resultado es sin comunicación, se hace una ronda extra de verificación
5. Al cambiar de estado se envía alerta WhatsApp
6. Al primer ciclo se informa el estado inicial
7. Emite `gateway_update` tras cada gateway, luego `estado_completo` + guarda en MongoDB al terminar el ciclo

### Ciclo SNMP (AP/PTP)

1. Consulta todos los dispositivos en paralelo via `net-snmp` subtree
2. Detecta cambios de estado
3. Primero hace broadcast WebSocket + guarda en MongoDB
4. Luego envía alertas WhatsApp en secuencia:
   - **Caída**: solo si el gateway del sector está **online** (suprime si el gateway también cayó)
   - **Recuperación**: solo si previamente se envió la alerta de caída

### WebSocket

Los clientes reciben al conectarse el estado completo. Mensajes:
- `estado_completo` — snapshot de todos los gateways y dispositivos
- `gateway_update` — resultado de un gateway individual tras su verificación ping

## API REST

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Login (username/email + password) → JWT |
| GET | `/api/auth/me` | Bearer JWT | Perfil del usuario actual |
| POST | `/api/users` | Bearer JWT (master) | Crear nuevo usuario |
| GET | `/api/historial/ultima-hora` | — | Snapshots de la última hora |
| GET | `/api/historial/fecha/:fecha` | — | Snapshots de una fecha (YYYY-MM-DD, hora Ecuador) |
| GET | `/api/historial/caidas/:fecha` | — | Conteo y % de caídas por dispositivo/gateway en una fecha |
| GET | `/api/historial/caidas/:fechaInicio/:fechaFin` | — | Caídas desglosadas por día en un rango |

## Estructura del Proyecto

```
MonitoreoAntenasIPSP/
├── index.js                    # Punto de entrada, loops de monitoreo
├── services/
│   ├── WhatsAppService.js      # Cliente Baileys (EventEmitter)
│   ├── WebSocketService.js     # Express + ws (EventEmitter)
│   └── SNMPService.js          # consultarSNMP() via net-snmp
├── routes/
│   ├── auth.js                 # /api/auth/login, /api/auth/me
│   ├── users.js                # /api/users
│   └── historial.js            # /api/historial/*
├── models/
│   ├── EstadoHistorico.js      # Mongoose: snapshots de estado
│   └── User.js                 # Mongoose: usuarios con roles
├── middleware/
│   └── authMiddleware.js       # requireAuth, requireRole
├── helpers/
│   ├── direcciones.js          # Config gateways (ping)
│   └── ap_ptp.js               # Config dispositivos AP/PTP (SNMP)
├── config/
│   └── database.js             # Conexión Mongoose
├── utils/
│   └── logger.js               # Pino logger
├── auth_info_baileys/          # Sesión WhatsApp (no commitear)
├── .env                        # Variables de entorno (no commitear)
├── package.json
└── CLAUDE.md
```

## Solución de Problemas

**QR no aparece / sesión inválida**: Elimina la carpeta `auth_info_baileys/` y vuelve a ejecutar `npm start`.

**MongoDB no conecta**: El error es fatal. Asegúrate de que MongoDB esté corriendo antes de iniciar.

**No llegan mensajes WhatsApp**: Verifica que los números en `WHATSAPP_NUMBERS` estén en formato internacional sin `+` (ej: `593984778678`).

**Alertas de antenas suprimidas sin razón aparente**: El gateway del sector debe estar online para que se envíen alertas de dispositivos. Revisa `helpers/direcciones.js` y que el nombre del grupo en `ap_ptp.js` coincida con un sector del gateway.

## Tecnologías

- **Node.js** (ES Modules)
- **@whiskeysockets/baileys** — Cliente WhatsApp Web
- **net-snmp** — Polling SNMP v1
- **ping** — ICMP ping
- **ws** — WebSocket server
- **Express 5** — HTTP/REST API
- **Mongoose** — ODM MongoDB
- **jsonwebtoken + bcryptjs** — Auth JWT
- **Pino** — Logger estructurado

## Autor

Jefferson Cabello — Melacorp S.A  
Licencia: ISC
