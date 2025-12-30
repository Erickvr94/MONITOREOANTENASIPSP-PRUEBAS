import { exec } from "child_process";
import { promisify } from "util";
import { WhatsAppService } from "./services/WhatsAppService.js";
import { direcciones } from "./helpers/direcciones.js";
import logger from "./utils/logger.js";
import "dotenv/config";

const execPromise = promisify(exec);

// Configuración desde .env
const WHATSAPP_NUMBERS = process.env.WHATSAPP_NUMBERS?.split(",") || [];
const MONITOR_INTERVAL = parseInt(process.env.MONITOR_INTERVAL) || 60000;
const MAX_ERROR_COUNT = parseInt(process.env.MAX_ERROR_COUNT) || 5;

// Estado de cada gateway (para detectar cambios)
const estadoGateways = {};

/**
 * Ejecuta ping nativo de Windows a una IP
 * @param {string} host - Dirección IP
 * @param {number} count - Número de paquetes a enviar
 * @returns {Object} - Resultado del ping
 */
async function ejecutarPing(host, count = 5) {
  try {
    const { stdout } = await execPromise(`ping -n ${count} ${host}`, {
      timeout: 15000,
    });

    // Parsear resultados de Windows
    const perdidosMatch = stdout.match(/perdidos = (\d+)/);
    const porcentajeMatch = stdout.match(/\((\d+)% perdidos\)/);
    const enviados = count;
    const perdidos = perdidosMatch ? parseInt(perdidosMatch[1]) : enviados;
    const porcentajePerdida = porcentajeMatch
      ? parseInt(porcentajeMatch[1])
      : 100;

    // Extraer tiempo promedio si está disponible
    const tiempoMatch = stdout.match(/Media = (\d+)ms/);
    const tiempoPromedio = tiempoMatch ? parseInt(tiempoMatch[1]) : null;

    return {
      exitoso: perdidos < count,
      enviados,
      perdidos,
      recibidos: enviados - perdidos,
      porcentajePerdida,
      tiempoPromedio,
    };
  } catch (error) {
    // Si el comando falla, asumimos que todos los paquetes se perdieron
    logger.warn(`Error ejecutando ping a ${host}: ${error.message}`);
    return {
      exitoso: false,
      enviados: count,
      perdidos: count,
      recibidos: 0,
      porcentajePerdida: 100,
      tiempoPromedio: null,
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
    const hayComunicacion = resultado.perdidos < 3;

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
  const hayComunicacion = verificacionesExitosas >= Math.ceil(totalVerificaciones / 2);

  logger.info(`\n${"=".repeat(60)}`);
  logger.info(
    `Resultado final: ${verificacionesExitosas}/${totalVerificaciones} verificaciones exitosas`,
  );
  logger.info(`Estado: ${hayComunicacion ? "✓ CON COMUNICACIÓN" : "✗ SIN COMUNICACIÓN"}`);
  logger.info("=".repeat(60));

  return {
    hayComunicacion,
    ultimoPing,
  };
}

/**
 * Monitorea todas las IPs configuradas
 * @param {WhatsAppService} whatsapp - Servicio de WhatsApp
 */
async function monitorearTodas(whatsapp) {
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

    // Guardar estado actual
    estadoGateways[id] = estadoActual;

    // Detectar cambio de estado y enviar alerta
    if (estadoAnterior !== undefined && estadoAnterior !== estadoActual) {
      // Cambio de estado - enviar alerta
      const mensaje = generarMensajeAlerta(id, IP, Sectores, estadoActual, ultimoPing);
      await enviarAlerta(whatsapp, mensaje);
    } else if (estadoAnterior === undefined) {
      // Primera verificación - informar estado inicial por WhatsApp
      logger.info(`Estado inicial registrado: ${estadoActual ? "CON" : "SIN"} comunicación`);
      const mensaje = generarMensajeEstadoInicial(id, IP, Sectores, estadoActual, ultimoPing);
      await enviarAlerta(whatsapp, mensaje);
    } else {
      // Sin cambios - no enviar mensaje
      logger.info(
        `Sin cambios en el estado (${estadoActual ? "CON" : "SIN"} comunicación)`,
      );
    }
  }

  logger.info("\n✅ Ciclo de monitoreo completado\n");
}

/**
 * Genera mensaje de estado inicial para WhatsApp
 * @param {string} id - ID del gateway
 * @param {string} ip - Dirección IP
 * @param {string[]} sectores - Sectores
 * @param {boolean} tieneConexion - Estado actual
 * @param {Object} ultimoPing - Datos del último ping
 * @returns {string} - Mensaje formateado
 */
function generarMensajeEstadoInicial(id, ip, sectores, tieneConexion, ultimoPing) {
  const fecha = new Date().toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
  });

  // Información del ping
  const infoPing = ultimoPing
    ? `\n📊 *Último Ping:*
   • Enviados: ${ultimoPing.enviados}
   • Recibidos: ${ultimoPing.recibidos}
   • Perdidos: ${ultimoPing.perdidos}
   • Pérdida: ${ultimoPing.porcentajePerdida}%${ultimoPing.tiempoPromedio ? `\n   • Tiempo: ${ultimoPing.tiempoPromedio}ms` : ""}`
    : "";

  if (tieneConexion) {
    return `🔵 *SISTEMA INICIADO*

📡 *Gateway ${id}*
🌐 IP: ${ip}
📍 Sectores: ${sectores.join(", ")}

✅ Estado inicial: CON COMUNICACIÓN${infoPing}

🕐 ${fecha}`;
  } else {
    return `🔵 *SISTEMA INICIADO*

📡 *Gateway ${id}*
🌐 IP: ${ip}
📍 Sectores: ${sectores.join(", ")}

⚠️ Estado inicial: SIN COMUNICACIÓN${infoPing}

🕐 ${fecha}`;
  }
}

/**
 * Genera mensaje de alerta para WhatsApp
 * @param {string} id - ID del gateway
 * @param {string} ip - Dirección IP
 * @param {string[]} sectores - Sectores afectados
 * @param {boolean} tieneConexion - Estado actual
 * @param {Object} ultimoPing - Datos del último ping
 * @returns {string} - Mensaje formateado
 */
function generarMensajeAlerta(id, ip, sectores, tieneConexion, ultimoPing) {
  const fecha = new Date().toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
  });

  // Información del ping
  const infoPing = ultimoPing
    ? `\n📊 *Último Ping:*
   • Enviados: ${ultimoPing.enviados}
   • Recibidos: ${ultimoPing.recibidos}
   • Perdidos: ${ultimoPing.perdidos}
   • Pérdida: ${ultimoPing.porcentajePerdida}%${ultimoPing.tiempoPromedio ? `\n   • Tiempo: ${ultimoPing.tiempoPromedio}ms` : ""}`
    : "";

  if (tieneConexion) {
    return `🟢 *COMUNICACIÓN RESTABLECIDA*

📡 *Gateway ${id}*
🌐 IP: ${ip}
📍 Sectores: ${sectores.join(", ")}

✅ La comunicación ha sido restablecida exitosamente.${infoPing}

🕐 ${fecha}`;
  } else {
    return `🔴 *ALERTA: SIN COMUNICACIÓN*

📡 *Gateway ${id}*
🌐 IP: ${ip}
📍 Sectores afectados: ${sectores.join(", ")}

⚠️ Se ha perdido la comunicación con este gateway.${infoPing}

🕐 ${fecha}`;
  }
}

/**
 * Envía alerta por WhatsApp a todos los números configurados
 * @param {WhatsAppService} whatsapp - Servicio de WhatsApp
 * @param {string} mensaje - Mensaje a enviar
 */
async function enviarAlerta(whatsapp, mensaje) {
  if (WHATSAPP_NUMBERS.length === 0) {
    logger.warn("⚠️  No hay números de WhatsApp configurados");
    return;
  }

  logger.info("\n📱 Enviando alertas por WhatsApp...");
  logger.info(`Mensaje:\n${mensaje}\n`);

  const resultados = await whatsapp.sendBroadcast(WHATSAPP_NUMBERS, mensaje);

  const exitosos = resultados.filter((r) => r.success).length;
  logger.info(
    `✅ Alertas enviadas: ${exitosos}/${WHATSAPP_NUMBERS.length} exitosas`,
  );
}

/**
 * Función principal
 */
async function main() {
  logger.info("╔═══════════════════════════════════════════════════════════╗");
  logger.info("║   SISTEMA DE MONITOREO DE ANTENAS Y GATEWAYS IPSP        ║");
  logger.info("╚═══════════════════════════════════════════════════════════╝\n");

  // Validar configuración
  if (Object.keys(direcciones).length === 0) {
    logger.error("❌ No hay gateways configurados en helpers/direcciones.js");
    process.exit(1);
  }

  logger.info("⚙️  Configuración:");
  logger.info(`   - Gateways a monitorear: ${Object.keys(direcciones).length}`);
  logger.info(`   - Intervalo de monitoreo: ${MONITOR_INTERVAL / 1000} segundos`);
  logger.info(`   - Verificaciones por ciclo: ${MAX_ERROR_COUNT}`);
  logger.info(`   - Números WhatsApp: ${WHATSAPP_NUMBERS.join(", ") || "Ninguno"}\n`);

  // Inicializar WhatsApp
  const whatsapp = new WhatsAppService();

  logger.info("📱 Conectando a WhatsApp...");
  await whatsapp.connect();

  // Esperar a que WhatsApp esté listo
  await new Promise((resolve) => {
    if (whatsapp.isConnected()) {
      resolve();
    } else {
      whatsapp.once("ready", resolve);
    }
  });

  logger.info("✅ WhatsApp conectado y listo\n");

  // Ejecutar primer monitoreo inmediatamente
  await monitorearTodas(whatsapp);

  // Configurar monitoreo periódico
  setInterval(async () => {
    await monitorearTodas(whatsapp);
  }, MONITOR_INTERVAL);

  logger.info(
    `\n⏰ Monitoreo automático configurado cada ${MONITOR_INTERVAL / 1000} segundos`,
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
