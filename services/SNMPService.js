import snmp from "net-snmp";
import logger from "../utils/logger.js";

const SNMP_COMMUNITY = process.env.SNMP_COMMUNITY || "public";
const SNMP_TIMEOUT = parseInt(process.env.SNMP_TIMEOUT) || 5000;
const SNMP_RETRIES = parseInt(process.env.SNMP_RETRIES) || 4;

/**
 * Consulta vía SNMP v1 subtree para verificar si un dispositivo está en línea.
 * @param {string} ip
 * @param {string} oid - OID a consultar (específico por dispositivo)
 * @returns {Promise<{online: boolean, value?: number, error?: string}>}
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
            value: resultados.length > 0 ? Number(resultados[0]) : null,
            count: resultados.length,
          });
        }
      },
    );
  });
}
