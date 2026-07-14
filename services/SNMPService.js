import snmp from "net-snmp";
import logger from "../utils/logger.js";

const SNMP_COMMUNITY = process.env.SNMP_COMMUNITY || "public";
const SNMP_TIMEOUT = parseInt(process.env.SNMP_TIMEOUT) || 5000;
const SNMP_RETRIES = parseInt(process.env.SNMP_RETRIES) || 4;

// OID_UPTIME = "1.3.6.1.2.1.1.3.0" Se usa ÚNICAMENTE para validar encendido/apagado del equipo.
const OID_UPTIME = "1.3.6.1.2.1.1.3.0";

/**
 * Consulta vía SNMP v1 subtree para verificar si un dispositivo está en línea.
 * @param {string} ip
 * @param {string} oid - OID a consultar (específico por dispositivo)
 * @returns {Promise<{online: boolean, potencia?: number, error?: string}>}
 */
export async function consultarSNMP(ip, oid) {
  return new Promise((resolve) => {
    let resolved = false;

    const session = snmp.createSession(ip, SNMP_COMMUNITY, {
      version: snmp.Version1,
      timeout: SNMP_TIMEOUT,
      retries: SNMP_RETRIES,
    });

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try {
        session.close();
      } catch (_) {}
      resolve(result);
    };

    session.on("error", (err) => {
      logger.debug(`[SNMP] Error de sesión ${ip}: ${err.message}`);
      finish({ online: false, error: err.message, count: 0 });
    });

    const resultados = [];

    session.subtree(
      oid,
      (varbinds) => {
        for (const vb of varbinds) {
          if (!snmp.isVarbindError(vb)) {
            resultados.push(vb.value);
          }
        }
      },
      (error) => {
        if (error) {
          logger.debug(`[SNMP] Error consulta ${ip}: ${error.message}`);
          finish({ online: false, error: error.message, count: 0 });
        } else {
          finish({
            online: resultados.length > 0,
            potencia: resultados.length ? Number(resultados[0]) : null,
            raw: resultados,
            fecha: new Date().toISOString(),
            error: null,
          });
        }
      },
    );
  });
}

/**
 * Valida encendido/apagado del equipo consultando sysUpTime.
 * Si responde: encendido. Si no responde: apagado o sin red.
 * @param {string} ip
 * @returns {Promise<{online: boolean, error: string|null}>}
 */
function validarEncendido(ip) {
  return new Promise((resolve) => {
    let resolved = false;

    const session = snmp.createSession(ip, SNMP_COMMUNITY, {
      version: snmp.Version1,
      timeout: SNMP_TIMEOUT,
      retries: SNMP_RETRIES,
    });

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try {
        session.close();
      } catch (_) {}
      resolve(result);
    };

    session.on("error", (err) => {
      logger.debug(`[SNMP] Error sesión sysUpTime ${ip}: ${err.message}`);
      finish({ online: false, error: err.message });
    });

    session.get([OID_UPTIME], (error, varbinds) => {
      if (error || !varbinds?.length || snmp.isVarbindError(varbinds[0])) {
        const msg = error?.message || "Sin respuesta sysUpTime";
        logger.debug(`[SNMP] sysUpTime ${ip}: ${msg}`);
        finish({ online: false, error: msg });
      } else {
        finish({ online: true, error: null });
      }
    });
  });
}

/**
 * Consulta completa de un dispositivo: estado + potencia EN PARALELO.
 *   - online   = el equipo respondió sysUpTime (encendido)
 *   - potencia = dBm del OID configurado en ap_ptp.js, o null si ese OID
 *    desapareció (ej: enlace PTP con el extremo remoto apagado)
 *
 * @param {string} ip
 * @param {string} oidPotencia - campo OID de ap_ptp.js
 * @returns {Promise<{online: boolean, potencia: number|null, error: string|null, fecha: string}>}
 */
export async function consultarDispositivo(ip, oidPotencia) {
  const [estadoRes, potenciaRes] = await Promise.all([
    validarEncendido(ip),
    consultarSNMP(ip, oidPotencia),
  ]);

  return {
    online: estadoRes.online,
    potencia: potenciaRes.online ? potenciaRes.potencia : null,
    error: estadoRes.error ?? null,
    fecha: new Date().toISOString(),
  };
}