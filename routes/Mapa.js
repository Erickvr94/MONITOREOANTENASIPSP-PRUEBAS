import { Router } from "express";
import { construirDatosMapa } from "../services/MapsService.js";

// mergeParams para acceder a :finca definido al montar la ruta en index.js
const router = Router({ mergeParams: true });

/**
 * GET /api/ipsp/:finca/mapa
 * Devuelve todas las antenas de la finca con coordenadas, estado online,
 * potencia (dBm) y fecha/hora de la última actualización SNMP.
 * Responde al instante: lee el estado en memoria, no consulta SNMP.
 */
router.get("/", (req, res) => {
  const { finca } = req.params;
  const monitores = req.app.locals.monitores || {};
  const monitor = monitores[finca];

  if (!monitor) {
    return res.status(404).json({ error: `Finca "${finca}" no encontrada` });
  }

  res.json(construirDatosMapa(finca, monitor));
});

export default router;