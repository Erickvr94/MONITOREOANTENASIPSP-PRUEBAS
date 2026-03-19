import { Router } from "express";
import { EstadoHistorico } from "../models/EstadoHistorico.js";

const router = Router();

/**
 * GET /api/historial/ultima-hora
 * Devuelve todos los registros de la última hora.
 */
router.get("/ultima-hora", async (req, res) => {
  try {
    const hace1Hora = new Date(Date.now() - 60 * 60 * 1000);
    const registros = await EstadoHistorico.find({
      timestamp: { $gte: hace1Hora },
    }).sort({ timestamp: 1 });

    res.json(registros);
  } catch (error) {
    res.status(500).json({ error: "Error al consultar historial" });
  }
});

/**
 * GET /api/historial/fecha/:fecha
 * Devuelve todos los registros de una fecha específica (hora local Ecuador UTC-5).
 * Formato: YYYY-MM-DD (ej: 2026-03-18)
 */
router.get("/fecha/:fecha", async (req, res) => {
  const { fecha } = req.params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: "Formato de fecha inválido. Use YYYY-MM-DD" });
  }

  try {
    // Interpretar la fecha como hora local Ecuador (UTC-5)
    const inicioLocal = new Date(`${fecha}T00:00:00-05:00`);
    const finLocal = new Date(`${fecha}T23:59:59.999-05:00`);

    const registros = await EstadoHistorico.find({
      timestamp: { $gte: inicioLocal, $lte: finLocal },
    }).sort({ timestamp: 1 });

    res.json(registros);
  } catch (error) {
    res.status(500).json({ error: "Error al consultar historial" });
  }
});

/**
 * GET /api/historial/caidas/:fecha
 * Devuelve el número de veces que cada antena/gateway estuvo offline en una fecha.
 * Formato: YYYY-MM-DD (ej: 2026-03-18). Interpreta la fecha en hora Ecuador (UTC-5).
 *
 * Respuesta:
 * {
 *   fecha: "2026-03-18",
 *   totalRegistros: 120,
 *   gateways: { "1": { ip, sectores, caidasCount, totalMuestras, porcentajeCaida }, ... },
 *   dispositivos: { "La Luz": { "AP1": { ip, ubicacion, caidasCount, totalMuestras, porcentajeCaida }, ... }, ... }
 * }
 */
router.get("/caidas/:fecha", async (req, res) => {
  const { fecha } = req.params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: "Formato de fecha inválido. Use YYYY-MM-DD" });
  }

  try {
    const inicioLocal = new Date(`${fecha}T00:00:00-05:00`);
    const finLocal = new Date(`${fecha}T23:59:59.999-05:00`);

    const registros = await EstadoHistorico.find({
      timestamp: { $gte: inicioLocal, $lte: finLocal },
    }).sort({ timestamp: 1 });

    // Contadores para gateways
    const gateways = {};

    // Contadores para dispositivos AP/PTP
    const dispositivos = {};

    for (const registro of registros) {
      // Procesar gateways
      if (registro.gateways) {
        for (const [id, gw] of Object.entries(registro.gateways)) {
          if (!gateways[id]) {
            gateways[id] = {
              ip: gw.ip,
              sectores: gw.sectores,
              caidasCount: 0,
              totalMuestras: 0,
            };
          }
          gateways[id].totalMuestras++;
          if (gw.online === false) {
            gateways[id].caidasCount++;
          }
        }
      }

      // Procesar dispositivos AP/PTP
      if (registro.dispositivos) {
        for (const [grupo, devices] of Object.entries(registro.dispositivos)) {
          if (!dispositivos[grupo]) {
            dispositivos[grupo] = {};
          }
          for (const [nombre, dev] of Object.entries(devices)) {
            if (!dispositivos[grupo][nombre]) {
              dispositivos[grupo][nombre] = {
                ip: dev.ip,
                ubicacion: dev.ubicacion,
                caidasCount: 0,
                totalMuestras: 0,
              };
            }
            dispositivos[grupo][nombre].totalMuestras++;
            if (dev.online === false) {
              dispositivos[grupo][nombre].caidasCount++;
            }
          }
        }
      }
    }

    // Calcular porcentaje de caída
    for (const gw of Object.values(gateways)) {
      gw.porcentajeCaida = gw.totalMuestras > 0
        ? Math.round((gw.caidasCount / gw.totalMuestras) * 10000) / 100
        : 0;
    }
    for (const grupo of Object.values(dispositivos)) {
      for (const dev of Object.values(grupo)) {
        dev.porcentajeCaida = dev.totalMuestras > 0
          ? Math.round((dev.caidasCount / dev.totalMuestras) * 10000) / 100
          : 0;
      }
    }

    res.json({
      fecha,
      totalRegistros: registros.length,
      gateways,
      dispositivos,
    });
  } catch (error) {
    res.status(500).json({ error: "Error al consultar caídas" });
  }
});

export default router;
