import fs from "fs/promises";
import path from "path";
import logger from "../utils/logger.js";

// Coordenadas cacheadas por finca: { [fincaId]: { [nombreDispositivo]: {lat, lon} } }
const coordenadasPorFinca = {};

/**
 * Carga (una sola vez, al arranque) las coordenadas de una finca.
 * Si no existe el archivo, la finca queda sin coordenadas pero no falla.
 */
export async function cargarCoordenadas(fincaId) {
  const archivo = path.join("config", "fincas", fincaId, "coordenadas.json");
  try {
    coordenadasPorFinca[fincaId] = JSON.parse(await fs.readFile(archivo, "utf8"));
    logger.info(
      `[${fincaId}] 🗺️  Coordenadas cargadas: ${Object.keys(coordenadasPorFinca[fincaId]).length}`,
    );
  } catch {
    coordenadasPorFinca[fincaId] = {};
    logger.warn(`[${fincaId}]  Sin coordenadas—el mapa tendrá lat/lon null`);
  }
}

/**
 * Construye el payload del mapa desde el estado EN MEMORIA del monitor.
 * NO consulta SNMP: los datos vienen del último ciclo de monitorearDispositivos().
 *
 * @param {string} fincaId
 * @param {object} monitor - entrada de `monitores[fincaId]` (config + estado)
 * @returns {object} { finca, timestamp, resumen, antenas: [...] }
 */
export function construirDatosMapa(fincaId, monitor) {
  const { config: { direccionesIP }, estado } = monitor;
  const coords = coordenadasPorFinca[fincaId] || {};

  const antenas = [];
  let online = 0, offline = 0, sinDatos = 0, enlacesCaidos = 0;

  for (const [grupo, dispositivos] of Object.entries(direccionesIP)) {
    for (const [nombre, info] of Object.entries(dispositivos)) {
      const key = `${grupo}.${nombre}`;
      const detalle = estado.detalleDispositivos[key] || {};
      const estadoOnline = estado.dispositivos[key] ?? null;

      if (estadoOnline === true) online++;
      else if (estadoOnline === false) offline++;
      else sinDatos++;

      // Equipo encendido pero sin enlace de radio (ej: extremo PTP apagado)
      if (estadoOnline === true && detalle.potencia == null) enlacesCaidos++;

      const coord = coords[nombre];
      antenas.push({
        id: key,
        nombre,
        grupo,
        ip: info.IP,
        ubicacion: info.Ubicacion ?? null,
        coordenadas: {
          lat: coord?.lat ?? null,
          lon: coord?.lon ?? null,
        },
        estado: {
          online: estadoOnline,                       // true = responde sysUpTime (encendida) | false | null (aún sin ciclo)
          potencia: detalle.potencia ?? null,          // dBm, null si el enlace no existe (ej: PTP remoto apagado)
          fecha: detalle.ultimaActualizacion ?? null,  // ISO 8601 del último ciclo SNMP
        },
        error: detalle.error ?? null,
      });
    }
  }

  return {
    finca: fincaId,
    timestamp: new Date().toISOString(),
    resumen: { total: antenas.length, online, offline, sinDatos, enlacesCaidos },
    antenas,
  };
}