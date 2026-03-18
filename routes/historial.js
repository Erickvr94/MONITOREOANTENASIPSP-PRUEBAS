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

export default router;
