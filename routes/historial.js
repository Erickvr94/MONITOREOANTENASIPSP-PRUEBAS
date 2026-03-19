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

/**
 * GET /api/historial/caidas/:fechaInicio/:fechaFin
 * Devuelve las caídas desglosadas por cada fecha dentro del rango.
 * Formato: YYYY-MM-DD / YYYY-MM-DD (ej: 2026-03-01/2026-03-19). Hora Ecuador (UTC-5).
 *
 * Respuesta:
 * {
 *   fechaInicio, fechaFin,
 *   dias: [
 *     { fecha: "2026-03-01", totalRegistros, gateways: { ... }, dispositivos: { ... } },
 *     { fecha: "2026-03-02", ... },
 *     ...
 *   ]
 * }
 */
router.get("/caidas/:fechaInicio/:fechaFin", async (req, res) => {
  const { fechaInicio, fechaFin } = req.params;
  const formatoFecha = /^\d{4}-\d{2}-\d{2}$/;

  if (!formatoFecha.test(fechaInicio) || !formatoFecha.test(fechaFin)) {
    return res.status(400).json({ error: "Formato de fecha inválido. Use YYYY-MM-DD" });
  }

  if (fechaInicio > fechaFin) {
    return res.status(400).json({ error: "fechaInicio debe ser anterior o igual a fechaFin" });
  }

  try {
    const inicio = new Date(`${fechaInicio}T00:00:00-05:00`);
    const fin = new Date(`${fechaFin}T23:59:59.999-05:00`);

    const registros = await EstadoHistorico.find({
      timestamp: { $gte: inicio, $lte: fin },
    }).sort({ timestamp: 1 });

    // Agrupar registros por fecha local Ecuador (UTC-5)
    const porDia = {};

    for (const registro of registros) {
      const fechaLocal = new Date(registro.timestamp.getTime() - 5 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      if (!porDia[fechaLocal]) {
        porDia[fechaLocal] = { gateways: {}, dispositivos: {}, totalRegistros: 0 };
      }

      const dia = porDia[fechaLocal];
      dia.totalRegistros++;

      if (registro.gateways) {
        for (const [id, gw] of Object.entries(registro.gateways)) {
          if (!dia.gateways[id]) {
            dia.gateways[id] = { ip: gw.ip, sectores: gw.sectores, caidasCount: 0, totalMuestras: 0 };
          }
          dia.gateways[id].totalMuestras++;
          if (gw.online === false) dia.gateways[id].caidasCount++;
        }
      }

      if (registro.dispositivos) {
        for (const [grupo, devices] of Object.entries(registro.dispositivos)) {
          if (!dia.dispositivos[grupo]) dia.dispositivos[grupo] = {};
          for (const [nombre, dev] of Object.entries(devices)) {
            if (!dia.dispositivos[grupo][nombre]) {
              dia.dispositivos[grupo][nombre] = { ip: dev.ip, ubicacion: dev.ubicacion, caidasCount: 0, totalMuestras: 0 };
            }
            dia.dispositivos[grupo][nombre].totalMuestras++;
            if (dev.online === false) dia.dispositivos[grupo][nombre].caidasCount++;
          }
        }
      }
    }

    // Calcular porcentajes por día
    const dias = Object.entries(porDia).map(([fecha, dia]) => {
      for (const gw of Object.values(dia.gateways)) {
        gw.porcentajeCaida = gw.totalMuestras > 0
          ? Math.round((gw.caidasCount / gw.totalMuestras) * 10000) / 100
          : 0;
      }
      for (const grupo of Object.values(dia.dispositivos)) {
        for (const dev of Object.values(grupo)) {
          dev.porcentajeCaida = dev.totalMuestras > 0
            ? Math.round((dev.caidasCount / dev.totalMuestras) * 10000) / 100
            : 0;
        }
      }
      return { fecha, ...dia };
    });

    res.json({ fechaInicio, fechaFin, dias });
  } catch (error) {
    res.status(500).json({ error: "Error al consultar caídas por rango" });
  }
});

export default router;
