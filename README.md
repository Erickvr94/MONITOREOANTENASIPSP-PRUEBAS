# 📡 Sistema de Monitoreo de Antenas y Gateways IPSP

Sistema automatizado de monitoreo de conectividad para antenas y gateways de IPSP con notificaciones en tiempo real vía WhatsApp.

## 🚀 Características

- **Monitoreo Automático**: Verificación continua de conectividad mediante ping a intervalos configurables
- **Notificaciones WhatsApp**: Alertas instantáneas cuando cambia el estado de conexión de los gateways
- **Verificación Robusta**: Sistema de 5 verificaciones con mayoría para evitar falsos positivos
- **Detección de Cambios**: Solo notifica cuando realmente hay un cambio de estado (evita spam)
- **Información Detallada**: Estadísticas de ping en cada notificación (paquetes perdidos, latencia, etc.)
- **Logging Estructurado**: Registro completo de todas las operaciones con Pino
- **Multi-Gateway**: Soporte para monitoreo simultáneo de múltiples gateways

## 📋 Requisitos Previos

- **Node.js**: v14 o superior
- **npm**: v6 o superior
- **Sistema Operativo**: Windows (usa comando `ping` nativo de Windows)
- **WhatsApp**: Cuenta de WhatsApp activa para recibir/enviar notificaciones

## 🔧 Instalación

1. **Clonar el repositorio**
   ```bash
   git clone <url-del-repositorio>
   cd MonitoreoAntenasIPSP
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**

   Edita el archivo `.env` con tu configuración:
   ```env
   # Números de WhatsApp (formato internacional sin +)
   WHATSAPP_NUMBERS=593984778678,593912345678

   # Intervalo entre ciclos de monitoreo (en milisegundos)
   MONITOR_INTERVAL=60000

   # Número de verificaciones por ciclo
   MAX_ERROR_COUNT=5

   # Nivel de logging (debug, info, warn, error)
   LOG_LEVEL=info
   ```

4. **Configurar gateways a monitorear**

   Edita `helpers/direcciones.js`:
   ```javascript
   const direcciones = {
     1: {
       IP: "192.169.116.1",
       Sectores: ["Garita", "Camaron", "Portillo"],
     },
     2: {
       IP: "192.168.120.1",
       Sectores: ["La Luz", "Taura 4", "Taura 5", "Taura 6"],
     },
     // Agrega más gateways según sea necesario
   };
   ```

## 🚀 Uso

### Iniciar el Sistema

```bash
npm start
```

### Primera Ejecución

1. El sistema mostrará un código QR en la terminal
2. Escanea el código QR con WhatsApp (vincula el dispositivo)
3. Una vez conectado, comenzará el monitoreo automático
4. Recibirás mensajes de "SISTEMA INICIADO" con el estado de cada gateway

### Detener el Sistema

Presiona `Ctrl + C` en la terminal

## 📊 Cómo Funciona

### Proceso de Verificación

Para cada gateway, el sistema ejecuta:

1. **5 Verificaciones consecutivas** (cada 2 segundos)
2. **Por cada verificación**:
   - Ejecuta 1 ping enviando 5 paquetes
   - Si se pierden < 3 paquetes → Verificación exitosa ✓
   - Si se pierden ≥ 3 paquetes → Verificación fallida ✗
3. **Resultado final**:
   - Si ≥ 3 verificaciones son exitosas → **CON COMUNICACIÓN** 🟢
   - Si ≥ 3 verificaciones fallan → **SIN COMUNICACIÓN** 🔴

### Lógica de Notificaciones

**Se envían mensajes solo cuando cambia el estado:**

| Estado Anterior | Estado Actual | Acción |
|----------------|---------------|--------|
| Ninguno (inicio) | Cualquiera | 🔵 Envía estado inicial |
| CON comunicación | SIN comunicación | 🔴 Envía alerta de pérdida |
| SIN comunicación | CON comunicación | 🟢 Envía alerta de restablecimiento |
| CON comunicación | CON comunicación | ⚪ No envía mensaje |
| SIN comunicación | SIN comunicación | ⚪ No envía mensaje |

## 📱 Formatos de Mensajes

### 🔵 Sistema Iniciado
```
🔵 *SISTEMA INICIADO*

📡 *Gateway 1*
🌐 IP: 192.169.116.1
📍 Sectores: Garita, Camaron, Portillo

✅ Estado inicial: CON COMUNICACIÓN

📊 *Último Ping:*
   • Enviados: 5
   • Recibidos: 5
   • Perdidos: 0
   • Pérdida: 0%
   • Tiempo: 15ms

🕐 30/12/2025, 10:30:45
```

### 🔴 Sin Comunicación
```
🔴 *ALERTA: SIN COMUNICACIÓN*

📡 *Gateway 1*
🌐 IP: 192.169.116.1
📍 Sectores afectados: Garita, Camaron, Portillo

⚠️ Se ha perdido la comunicación con este gateway.

📊 *Último Ping:*
   • Enviados: 5
   • Recibidos: 0
   • Perdidos: 5
   • Pérdida: 100%

🕐 30/12/2025, 12:30:45
```

### 🟢 Comunicación Restablecida
```
🟢 *COMUNICACIÓN RESTABLECIDA*

📡 *Gateway 1*
🌐 IP: 192.169.116.1
📍 Sectores: Garita, Camaron, Portillo

✅ La comunicación ha sido restablecida exitosamente.

📊 *Último Ping:*
   • Enviados: 5
   • Recibidos: 4
   • Perdidos: 1
   • Pérdida: 20%
   • Tiempo: 28ms

🕐 30/12/2025, 14:30:45
```

## 📁 Estructura del Proyecto

```
MonitoreoAntenasIPSP/
├── index.js                    # Punto de entrada principal
├── services/
│   └── WhatsAppService.js      # Servicio de WhatsApp (Baileys)
├── helpers/
│   └── direcciones.js          # Configuración de gateways
├── utils/
│   └── logger.js               # Logger centralizado (Pino)
├── .env                        # Variables de entorno
├── package.json                # Dependencias del proyecto
├── README.md                   # Este archivo
└── CLAUDE.md                   # Guía para Claude Code
```

## 🔍 Solución de Problemas

### El código QR no aparece
- Verifica que no exista la carpeta `auth_info_baileys/`
- Si existe, elimínala y vuelve a ejecutar `npm start`

### WhatsApp se desconecta constantemente
- Asegúrate de tener buena conexión a internet
- No cierres WhatsApp en tu teléfono
- Verifica que no tengas WhatsApp Web abierto en otro navegador

### No se reciben mensajes
- Verifica que los números en `.env` estén en formato correcto (sin `+`)
- Ejemplo correcto: `593984778678`
- Ejemplo incorrecto: `+593984778678` o `0984778678`

### Los pings fallan constantemente
- Verifica que las IPs en `helpers/direcciones.js` sean correctas
- Confirma que tienes conectividad de red hacia esas IPs
- Prueba hacer ping manual: `ping 192.169.116.1`

### Error "Cannot find module"
- Ejecuta `npm install` nuevamente
- Verifica que tengas Node.js v14 o superior: `node --version`

## 🛠️ Tecnologías Utilizadas

- **Node.js**: Entorno de ejecución
- **@whiskeysockets/baileys**: Cliente de WhatsApp Web
- **Pino**: Logger de alto rendimiento
- **Express**: Framework HTTP (preparado para futura API)
- **dotenv**: Gestión de variables de entorno

## 📝 Notas

- El sistema usa el comando `ping` nativo de Windows
- Los números de teléfono deben estar en formato internacional sin `+`
- Por defecto, el sistema asume código de país de Ecuador (+593) si no se especifica
- La autenticación de WhatsApp se guarda en `auth_info_baileys/` (ya incluido en `.gitignore`)

## 👤 Autor

**Jefferson Cabello**
Desarrollado para Melacorp S.A

## 📄 Licencia

ISC

---

⚡ **Sistema de Monitoreo IPSP** - Mantén tus gateways bajo vigilancia 24/7
