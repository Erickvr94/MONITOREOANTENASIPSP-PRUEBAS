import ping from "ping";
import { WebSocketService } from "./services/WebSocketService.js";
import { consultarSNMP } from "./services/SNMPService.js";
import { connectDatabase } from "./config/database.js";
import historialRoutes from "./routes/historial.js";
import { crearModeloEstadoHistorico } from "./models/EstadoHistorico.js";
import { fincasConfig } from "./config/fincas.js";
import logger from "./utils/logger.js";
import "dotenv/config";

const MONITOR_INTERVAL = parseInt(process.env.MONITOR_INTERVAL) || 60000;
const MAX_ERROR_COUNT = parseInt(process.env.MAX_ERROR_COUNT) || 5;
const SNMP_INTERVAL = parseInt(process.env.SNMP_INTERVAL) || 30000;

// Estado y config por finca: { [fincaId]: { config, estado, modelo } }
const monitores = {};

let wsService = null;

async function ejecutarPing(host, count = 5) {
  try {
    logger.debug(`Ejecutando ping a ${host} (${count} paquetes)`);

    let exitosos = 0;
    let tiempoTotal = 0;
    const resultados = [];

    for (let i = 0; i < count; i++) {
      const res = await ping.promise.probe(host, {
        timeout: 3,
        extra: ["-n", "1"],
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

async function verificarEstadoIP(host) {
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(`Verificando estado de ${host}`);
  logger.info("=".repeat(60));

  let verificacionesExitosas = 0;
  const totalVerificaciones = MAX_ERROR_COUNT;
  let ultimoPing = null;

  for (let i = 0; i < totalVerificaciones; i++) {
    logger.info(`\nVerificación ${i + 1}/${totalVerificaciones}:`);

    const resultado = await ejecutarPing(host, 5);
    ultimoPing = resultado;

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

    if (i < totalVerificaciones - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  let hayComunicacion =
    verificacionesExitosas >= Math.ceil(totalVerificaciones / 2);

  logger.info(`\n${"=".repeat(60)}`);
  logger.info(
    `Resultado inicial: ${verificacionesExitosas}/${totalVerificaciones} verificaciones exitosas`,
  );
  logger.info(
    `Estado preliminar: ${hayComunicacion ? "✓ CON COMUNICACIÓN" : "✗ SIN COMUNICACIÓN"}`,
  );

  if (!hayComunicacion) {
    logger.info(`\n${"=".repeat(60)}`);
    logger.info("🔍 Realizando verificación extra para confirmar estado...");
    logger.info("=".repeat(60));

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const verificacionExtra = await ejecutarPing(host, 5);
    ultimoPing = verificacionExtra;

    const comunicacionExtra = verificacionExtra.perdidos < 3;

    if (comunicacionExtra) {
      logger.info(
        `✓ Verificación extra exitosa (${verificacionExtra.recibidos}/${verificacionExtra.enviados} paquetes recibidos)`,
      );
      logger.info("🟢 La comunicación acaba de regresar");
      hayComunicacion = true;
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

  return { hayComunicacion, ultimoPing };
}

async function monitorearTodas(fincaId) {
  const { config: { direcciones }, estado } = monitores[fincaId];

  logger.info(`\n[${fincaId}] 🔍 Iniciando ciclo de monitoreo...\n`);

  for (const [id, gateway] of Object.entries(direcciones)) {
    const { IP, Sectores } = gateway;

    logger.info(`\n[${fincaId}] 📡 Monitoreando Gateway ${id}: ${IP}`);
    logger.info(`   Sectores: ${Sectores.join(", ")}`);

    const resultado = await verificarEstadoIP(IP);
    const estadoActual = resultado.hayComunicacion;
    const ultimoPing = resultado.ultimoPing;

    const estadoAnterior = estado.gateways[id];

    estado.gateways[id] = estadoActual;
    estado.detalleGateways[id] = {
      ultimoPing,
      ultimaActualizacion: new Date().toISOString(),
    };

    wsService?.broadcastToFinca(fincaId, {
      tipo: "gateway_update",
      finca: fincaId,
      id,
      ip: IP,
      sectores: Sectores,
      online: estadoActual,
      ultimoPing,
      ultimaActualizacion: estado.detalleGateways[id].ultimaActualizacion,
    });

    if (estadoAnterior !== undefined && estadoAnterior !== estadoActual) {
      logger.info(
        `[${fincaId}] Cambio: ${estadoAnterior ? "CON" : "SIN"} → ${estadoActual ? "CON" : "SIN"} comunicación`,
      );
    } else if (estadoAnterior === undefined) {
      logger.info(
        `[${fincaId}] Estado inicial: ${estadoActual ? "CON" : "SIN"} comunicación`,
      );
    } else {
      logger.info(
        `[${fincaId}] Sin cambios (${estadoActual ? "CON" : "SIN"} comunicación)`,
      );
    }
  }

  logger.info(`\n[${fincaId}] ✅ Ciclo de monitoreo completado\n`);

  await broadcastYGuardar(fincaId);
}

function construirEstadoCompleto(fincaId) {
  const { config: { direcciones, direccionesIP }, estado } = monitores[fincaId];

  const gateways = Object.entries(direcciones).reduce((acc, [id, gw]) => {
    acc[id] = {
      ip: gw.IP,
      sectores: gw.Sectores,
      online: estado.gateways[id] ?? null,
      ...(estado.detalleGateways[id] || {}),
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
          online: estado.dispositivos[key] ?? null,
          ...(estado.detalleDispositivos[key] || {}),
        };
        return dacc;
      }, {});
      return acc;
    },
    {},
  );

  return {
    tipo: "estado_completo",
    finca: fincaId,
    timestamp: new Date().toISOString(),
    gateways,
    dispositivos,
  };
}

async function broadcastYGuardar(fincaId) {
  const estado = construirEstadoCompleto(fincaId);
  wsService?.broadcastToFinca(fincaId, estado);

  try {
    await monitores[fincaId].modelo.create({
      timestamp: new Date(estado.timestamp),
      gateways: estado.gateways,
      dispositivos: estado.dispositivos,
    });
  } catch (error) {
    logger.error(`[${fincaId}] Error al guardar historial: ${error.message}`);
  }
}

async function monitorearDispositivos(fincaId) {
  const { config: { direccionesIP }, estado } = monitores[fincaId];

  logger.info(`\n[${fincaId}] 📶 Iniciando monitoreo SNMP de dispositivos AP/PTP...`);

  const tareas = [];

  for (const [grupo, devices] of Object.entries(direccionesIP)) {
    for (const [nombre, info] of Object.entries(devices)) {
      const key = `${grupo}.${nombre}`;

      tareas.push(
        consultarSNMP(info.IP, info.OID).then((resultado) => {
          const estadoAnterior = estado.dispositivos[key];
          const estadoActual = resultado.online;

          estado.dispositivos[key] = estadoActual;
          estado.detalleDispositivos[key] = {
            uptime: resultado.uptime ?? null,
            error: resultado.error ?? null,
            ultimaActualizacion: new Date().toISOString(),
          };

          if (!estadoActual) {
            estado.erroresConsecutivos[key] =
              (estado.erroresConsecutivos[key] || 0) + 1;
          } else {
            estado.erroresConsecutivos[key] = 0;
          }

          if (estadoAnterior !== undefined && estadoAnterior !== estadoActual) {
            logger.info(
              `[${fincaId}][SNMP] ${grupo} > ${nombre} (${info.IP}): ${estadoActual ? "🟢 EN LÍNEA" : "🔴 SIN RESPUESTA"}`,
            );
          } else if (estadoAnterior === undefined) {
            logger.info(
              `[${fincaId}][SNMP] ${grupo} > ${nombre} (${info.IP}): estado inicial ${estadoActual ? "🟢 EN LÍNEA" : "🔴 SIN RESPUESTA"}`,
            );
          }
        }),
      );
    }
  }

  await Promise.all(tareas);
  await broadcastYGuardar(fincaId);

  logger.info(`[${fincaId}] ✅ Monitoreo SNMP completado\n`);
}

async function main() {
  logger.info("╔═══════════════════════════════════════════════════════════╗");
  logger.info("║   SISTEMA DE MONITOREO DE ANTENAS Y GATEWAYS IPSP        ║");
  logger.info(
    "╚═══════════════════════════════════════════════════════════╝\n",
  );

  const conn = await connectDatabase();

  for (const [fincaId, meta] of Object.entries(fincasConfig)) {
    let direcciones = {};
    let direccionesIP = {};
    try {
      const { direccionesIP: dp } = await import(
        `./config/fincas/${fincaId}/ap_ptp.js`
      );
      direccionesIP = dp;
    } catch {
      logger.warn(
        `[${fincaId}] ⚠️  No se encontró config/fincas/${fincaId}/ap_ptp.js — omitiendo`,
      );
      continue;
    }
    try {
      const { direcciones: d } = await import(
        `./config/fincas/${fincaId}/direcciones.js`
      );
      direcciones = d;
    } catch {
      logger.info(
        `[${fincaId}] Sin gateways configurados (no existe direcciones.js)`,
      );
    }

    const modelo = crearModeloEstadoHistorico(conn, fincaId);

    const totalDispositivos = Object.values(direccionesIP).reduce(
      (sum, grupo) => sum + Object.keys(grupo).length,
      0,
    );

    monitores[fincaId] = {
      config: { direcciones, direccionesIP },
      estado: {
        gateways: {},
        detalleGateways: {},
        dispositivos: {},
        detalleDispositivos: {},
        erroresConsecutivos: {},
      },
      modelo,
    };

    logger.info(
      `🏭 [${fincaId}] "${meta.nombre}" — ${Object.keys(direcciones).length} gateways, ${totalDispositivos} dispositivos AP/PTP`,
    );
  }

  if (Object.keys(monitores).length === 0) {
    logger.error(
      "❌ No se cargó ninguna finca. Verifica config/fincas.js y que exista al menos un ap_ptp.js.",
    );
    process.exit(1);
  }

  logger.info(
    `\n⚙️  Ping: cada ${MONITOR_INTERVAL / 1000}s | SNMP: cada ${SNMP_INTERVAL / 1000}s | Verificaciones/ciclo: ${MAX_ERROR_COUNT}\n`,
  );

  wsService = new WebSocketService();
  wsService.app.locals.modelosPorFinca = Object.fromEntries(
    Object.entries(monitores).map(([id, m]) => [id, m.modelo]),
  );
  wsService.use("/api/ipsp/:finca/historial", historialRoutes);
  await wsService.start();

  wsService.on("client_subscribed", (ws, finca) => {
    if (monitores[finca]) {
      wsService.sendToClient(ws, construirEstadoCompleto(finca));
    } else {
      wsService.sendToClient(ws, {
        tipo: "error",
        mensaje: `Finca "${finca}" no encontrada`,
      });
    }
  });

  // Arrancar monitoreo de todas las fincas en paralelo
  await Promise.all(
    Object.keys(monitores).map((fincaId) =>
      Promise.all([monitorearTodas(fincaId), monitorearDispositivos(fincaId)]),
    ),
  );

  for (const fincaId of Object.keys(monitores)) {
    setInterval(() => monitorearTodas(fincaId), MONITOR_INTERVAL);
    setInterval(() => monitorearDispositivos(fincaId), SNMP_INTERVAL);
  }

  logger.info(
    `\n⏰ Monitoreo activo para ${Object.keys(monitores).length} finca(s): ${Object.keys(monitores).join(", ")}`,
  );
}

process.on("unhandledRejection", (error) => {
  logger.error("Error no manejado:", error);
});

process.on("SIGINT", () => {
  logger.info("\n\n👋 Deteniendo sistema de monitoreo...");
  process.exit(0);
});

main().catch((error) => {
  logger.error("Error fatal:", error);
  process.exit(1);
});
