import ping from "ping";
import { WebSocketService } from "./services/WebSocketService.js";
import { consultarSNMP } from "./services/SNMPService.js";
import { connectDatabase } from "./config/database.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import historialRoutes from "./routes/historial.js";
import { EstadoHistorico } from "./models/EstadoHistorico.js";
import { direcciones } from "./helpers/direcciones.js";
import { direccionesIP } from "./helpers/ap_ptp.js";
import logger from "./utils/logger.js";
import "dotenv/config";

// Configuración desde .env
const MONITOR_INTERVAL = parseInt(process.env.MONITOR_INTERVAL) || 60000;
const MAX_ERROR_COUNT = parseInt(process.env.MAX_ERROR_COUNT) || 5;
const SNMP_INTERVAL = parseInt(process.env.SNMP_INTERVAL) || 30000;

// Estado de cada gateway (para detectar cambios y broadcasting)
const estadoGateways = {};
const detalleGateways = {};

// Estado de dispositivos SNMP (AP/PTP)
const estadoDispositivos = {};
const detalleDispositivos = {};
// Errores consecutivos por dispositivo SNMP (se resetea al volver a estar online)
const erroresConsecutivosDispositivos = {};

// Servicio WebSocket
let wsService = null;

/**
 * Ejecuta ping a una IP usando el paquete 'ping' (más robusto que child_process)
 * @param {string} host - Dirección IP
 * @param {number} count - Número de paquetes a enviar
 * @returns {Object} - Resultado del ping
 */
async function ejecutarPing(host, count = 5) {
  try {
    logger.debug(`Ejecutando ping a ${host} (${count} paquetes)`);

    let exitosos = 0;
    let tiempoTotal = 0;
    const resultados = [];

    // Ejecutar múltiples pings para obtener estadísticas
    for (let i = 0; i < count; i++) {
      const res = await ping.promise.probe(host, {
        timeout: 3, // 3 segundos de timeout por ping
        extra: ["-n", "1"], // Solo 1 paquete por intento
      });

      resultados.push(res);

      if (res.alive) {
        exitosos++;
        if (res.time !== "unknown") {
          tiempoTotal += parseFloat(res.time);
        }
      }

      logger.debug(
        `  Intento ${i + 1}/${count}: ${res.alive ? "✓" : "✗"} (${res.time}ms)`,
      );

      // Pequeña pausa entre pings (excepto el último)
      if (i < count - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const perdidos = count - exitosos;
    const porcentajePerdida = Math.round((perdidos / count) * 100);
    const tiempoPromedio =
      exitosos > 0 ? Math.round(tiempoTotal / exitosos) : null;

    logger.debug(
      `Resultado: ${exitosos}/${count} exitosos, ${porcentajePerdida}% pérdida`,
    );

    return {
      exitoso: exitosos > 0,
      enviados: count,
      perdidos,
      recibidos: exitosos,
      porcentajePerdida,
      tiempoPromedio,
    };
  } catch (error) {
    // Capturar error detallado para diagnóstico
    logger.error(`❌ ERROR EJECUTANDO PING a ${host}:`);
    logger.error(`   Mensaje: ${error.message}`);
    logger.error(`   Stack: ${error.stack}`);

    return {
      exitoso: false,
      enviados: count,
      perdidos: count,
      recibidos: 0,
      porcentajePerdida: 100,
      tiempoPromedio: null,
      error: error.message,
    };
  }
}

/**
 * Verifica el estado de una IP realizando 5 verificaciones
 * @param {string} host - Dirección IP
 * @returns {Object} - { hayComunicacion: boolean, ultimoPing: Object }
 */
async function verificarEstadoIP(host) {
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(`Verificando estado de ${host}`);
  logger.info("=".repeat(60));

  let verificacionesExitosas = 0;
  const totalVerificaciones = MAX_ERROR_COUNT;
  let ultimoPing = null;

  for (let i = 0; i < totalVerificaciones; i++) {
    logger.info(`\nVerificación ${i + 1}/${totalVerificaciones}:`);

    // Ejecutar un solo ping con 5 paquetes
    const resultado = await ejecutarPing(host, 5);
    ultimoPing = resultado; // Guardar el último resultado

    // Hay comunicación si se pierden menos de 3 paquetes (de 5)
    let hayComunicacion = resultado.perdidos < 3;

    if (hayComunicacion) {
      verificacionesExitosas++;
      logger.info(
        `✓ Comunicación OK (${resultado.recibidos}/${resultado.enviados} paquetes recibidos, ${resultado.perdidos} perdidos)`,
      );
    } else {
      logger.warn(
        `✗ Sin comunicación (${resultado.recibidos}/${resultado.enviados} paquetes recibidos, ${resultado.perdidos} perdidos)`,
      );
    }

    // Pausa entre verificaciones (excepto la última)
    if (i < totalVerificaciones - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Hay comunicación si la mayoría de verificaciones fueron exitosas (3 o más de 5)
  let hayComunicacion =
    verificacionesExitosas >= Math.ceil(totalVerificaciones / 2);

  logger.info(`\n${"=".repeat(60)}`);
  logger.info(
    `Resultado inicial: ${verificacionesExitosas}/${totalVerificaciones} verificaciones exitosas`,
  );
  logger.info(
    `Estado preliminar: ${hayComunicacion ? "✓ CON COMUNICACIÓN" : "✗ SIN COMUNICACIÓN"}`,
  );

  // Si el resultado fue SIN COMUNICACIÓN, hacer una verificación extra
  // para detectar si la comunicación acaba de regresar
  if (!hayComunicacion) {
    logger.info(`\n${"=".repeat(60)}`);
    logger.info("🔍 Realizando verificación extra para confirmar estado...");
    logger.info("=".repeat(60));

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const verificacionExtra = await ejecutarPing(host, 5);
    ultimoPing = verificacionExtra; // Actualizar con la verificación extra

    const comunicacionExtra = verificacionExtra.perdidos < 3;

    if (comunicacionExtra) {
      logger.info(
        `✓ Verificación extra exitosa (${verificacionExtra.recibidos}/${verificacionExtra.enviados} paquetes recibidos)`,
      );
      logger.info("🟢 La comunicación acaba de regresar");
      hayComunicacion = true; // Cambiar estado a CON COMUNICACIÓN
    } else {
      logger.warn(
        `✗ Verificación extra fallida (${verificacionExtra.recibidos}/${verificacionExtra.enviados} paquetes recibidos)`,
      );
      logger.warn("🔴 Confirmado: SIN COMUNICACIÓN");
    }
  }

  logger.info(`\n${"=".repeat(60)}`);
  logger.info(
    `Estado final: ${hayComunicacion ? "✓ CON COMUNICACIÓN" : "✗ SIN COMUNICACIÓN"}`,
  );
  logger.info("=".repeat(60));

  return {
    hayComunicacion,
    ultimoPing,
  };
}

async function monitorearTodas() {
  logger.info("\n🔍 Iniciando ciclo de monitoreo...\n");

  for (const [id, gateway] of Object.entries(direcciones)) {
    const { IP, Sectores } = gateway;

    logger.info(`\n📡 Monitoreando Gateway ${id}: ${IP}`);
    logger.info(`   Sectores: ${Sectores.join(", ")}`);

    // Verificar estado actual
    const resultado = await verificarEstadoIP(IP);
    const estadoActual = resultado.hayComunicacion;
    const ultimoPing = resultado.ultimoPing;

    // Obtener estado anterior (undefined si es la primera vez)
    const estadoAnterior = estadoGateways[id];

    // Guardar estado actual y detalle para WebSocket
    estadoGateways[id] = estadoActual;
    detalleGateways[id] = {
      ultimoPing,
      ultimaActualizacion: new Date().toISOString(),
    };

    // Notificar a clientes WebSocket con el estado actualizado de este gateway
    wsService?.broadcast({
      tipo: "gateway_update",
      id,
      ip: IP,
      sectores: Sectores,
      online: estadoActual,
      ultimoPing,
      ultimaActualizacion: detalleGateways[id].ultimaActualizacion,
    });

    if (estadoAnterior !== undefined && estadoAnterior !== estadoActual) {
      logger.info(
        `Cambio de estado: ${estadoAnterior ? "CON" : "SIN"} → ${estadoActual ? "CON" : "SIN"} comunicación`,
      );
    } else if (estadoAnterior === undefined) {
      logger.info(
        `Estado inicial registrado: ${estadoActual ? "CON" : "SIN"} comunicación`,
      );
    } else {
      logger.info(
        `Sin cambios en el estado (${estadoActual ? "CON" : "SIN"} comunicación)`,
      );
    }
  }

  logger.info("\n✅ Ciclo de monitoreo completado\n");

  // Broadcast del estado completo al terminar el ciclo de gateways y guardar historial
  await broadcastYGuardar();
}

/**
 * Construye el estado completo de todos los dispositivos para broadcasting WebSocket.
 * @returns {object}
 */
function construirEstadoCompleto() {
  const gateways = Object.entries(direcciones).reduce((acc, [id, gw]) => {
    acc[id] = {
      ip: gw.IP,
      sectores: gw.Sectores,
      online: estadoGateways[id] ?? null,
      ...(detalleGateways[id] || {}),
    };
    return acc;
  }, {});

  const dispositivos = Object.entries(direccionesIP).reduce(
    (acc, [grupo, devices]) => {
      acc[grupo] = Object.entries(devices).reduce((dacc, [nombre, info]) => {
        const key = `${grupo}.${nombre}`;
        dacc[nombre] = {
          ip: info.IP,
          ubicacion: info.Ubicacion,
          online: estadoDispositivos[key] ?? null,
          ...(detalleDispositivos[key] || {}),
        };
        return dacc;
      }, {});
      return acc;
    },
    {},
  );

  return {
    tipo: "estado_completo",
    timestamp: new Date().toISOString(),
    gateways,
    dispositivos,
  };
}

/**
 * Construye el estado completo, lo guarda en MongoDB y lo emite por WebSocket.
 */
async function broadcastYGuardar() {
  const estado = construirEstadoCompleto();
  wsService?.broadcast(estado);

  try {
    await EstadoHistorico.create({
      timestamp: new Date(estado.timestamp),
      gateways: estado.gateways,
      dispositivos: estado.dispositivos,
    });
  } catch (error) {
    logger.error(`Error al guardar historial: ${error.message}`);
  }
}


async function monitorearDispositivos() {
  logger.info("\n📶 Iniciando monitoreo SNMP de dispositivos AP/PTP...");

  const tareas = [];

  for (const [grupo, devices] of Object.entries(direccionesIP)) {
    for (const [nombre, info] of Object.entries(devices)) {
      const key = `${grupo}.${nombre}`;

      tareas.push(
        consultarSNMP(info.IP, info.OID).then((resultado) => {
          const estadoAnterior = estadoDispositivos[key];
          const estadoActual = resultado.online;

          estadoDispositivos[key] = estadoActual;
          detalleDispositivos[key] = {
            uptime: resultado.uptime ?? null,
            error: resultado.error ?? null,
            ultimaActualizacion: new Date().toISOString(),
          };

          if (!estadoActual) {
            erroresConsecutivosDispositivos[key] =
              (erroresConsecutivosDispositivos[key] || 0) + 1;
          } else {
            erroresConsecutivosDispositivos[key] = 0;
          }

          if (estadoAnterior !== undefined && estadoAnterior !== estadoActual) {
            logger.info(
              `[SNMP] ${grupo} > ${nombre} (${info.IP}): ${estadoActual ? "🟢 EN LÍNEA" : "🔴 SIN RESPUESTA"}`,
            );
          } else if (estadoAnterior === undefined) {
            logger.info(
              `[SNMP] ${grupo} > ${nombre} (${info.IP}): estado inicial ${estadoActual ? "🟢 EN LÍNEA" : "🔴 SIN RESPUESTA"}`,
            );
          }
        }),
      );
    }
  }

  await Promise.all(tareas);
  await broadcastYGuardar();

  logger.info("✅ Monitoreo SNMP completado\n");
}

/**
 * Función principal
 */
async function main() {
  logger.info("╔═══════════════════════════════════════════════════════════╗");
  logger.info("║   SISTEMA DE MONITOREO DE ANTENAS Y GATEWAYS IPSP        ║");
  logger.info(
    "╚═══════════════════════════════════════════════════════════╝\n",
  );

  // Validar configuración
  if (Object.keys(direcciones).length === 0) {
    logger.error("❌ No hay gateways configurados en helpers/direcciones.js");
    process.exit(1);
  }

  // Contar dispositivos AP/PTP
  const totalDispositivos = Object.values(direccionesIP).reduce(
    (sum, grupo) => sum + Object.keys(grupo).length,
    0,
  );

  logger.info("⚙️  Configuración:");
  logger.info(`   - Gateways a monitorear: ${Object.keys(direcciones).length}`);
  logger.info(`   - Dispositivos AP/PTP (SNMP): ${totalDispositivos}`);
  logger.info(
    `   - Intervalo de monitoreo (ping): ${MONITOR_INTERVAL / 1000} segundos`,
  );
  logger.info(
    `   - Intervalo de monitoreo (SNMP): ${SNMP_INTERVAL / 1000} segundos`,
  );
  logger.info(`   - Verificaciones por ciclo: ${MAX_ERROR_COUNT}\n`);

  // Conectar base de datos
  await connectDatabase();

  // Inicializar WebSocket + HTTP server
  wsService = new WebSocketService();
  wsService.use("/api/auth", authRoutes);
  wsService.use("/api/users", userRoutes);
  wsService.use("/api/historial", historialRoutes);
  await wsService.start();

  // Enviar estado completo a cada nuevo cliente al conectarse
  wsService.on("client_connected", (ws) => {
    wsService.sendToClient(ws, construirEstadoCompleto());
  });

  // Ejecutar primer monitoreo inmediatamente
  await Promise.all([monitorearTodas(), monitorearDispositivos()]);

  setInterval(async () => {
    await monitorearTodas();
  }, MONITOR_INTERVAL);

  setInterval(async () => {
    await monitorearDispositivos();
  }, SNMP_INTERVAL);

  logger.info(
    `\n⏰ Monitoreo ping configurado cada ${MONITOR_INTERVAL / 1000} segundos`,
  );
  logger.info(
    `⏰ Monitoreo SNMP configurado cada ${SNMP_INTERVAL / 1000} segundos`,
  );
}

// Manejar errores no capturados
process.on("unhandledRejection", (error) => {
  logger.error("Error no manejado:", error);
});

process.on("SIGINT", () => {
  logger.info("\n\n👋 Deteniendo sistema de monitoreo...");
  process.exit(0);
});

// Iniciar aplicación
main().catch((error) => {
  logger.error("Error fatal:", error);
  process.exit(1);
});
