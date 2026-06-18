import { Router } from "express";

const router = Router({ mergeParams: true });

function getModelo(req, res) {
  const { finca } = req.params;
  const modelo = req.app.locals.modelosPorFinca?.[finca];
  if (!modelo) {
    res.status(404).json({ error: `Finca "${finca}" no encontrada` });
    return null;
  }
  return modelo;
}

router.get("/ultima-hora", async (req, res) => {
  const modelo = getModelo(req, res);
  if (!modelo) return;

  try {
    const hace1Hora = new Date(Date.now() - 60 * 60 * 1000);
    const registros = await modelo
      .find({ timestamp: { $gte: hace1Hora } })
      .sort({ timestamp: 1 });
    res.json(registros);
  } catch {
    res.status(500).json({ error: "Error al consultar historial" });
  }
});

router.get("/fecha/:fecha", async (req, res) => {
  const modelo = getModelo(req, res);
  if (!modelo) return;

  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: "Formato de fecha inválido. Use YYYY-MM-DD" });
  }

  try {
    const inicioLocal = new Date(`${fecha}T00:00:00-05:00`);
    const finLocal = new Date(`${fecha}T23:59:59.999-05:00`);
    const registros = await modelo
      .find({ timestamp: { $gte: inicioLocal, $lte: finLocal } })
      .sort({ timestamp: 1 });
    res.json(registros);
  } catch {
    res.status(500).json({ error: "Error al consultar historial" });
  }
});

router.get("/caidas/:fecha", async (req, res) => {
  const modelo = getModelo(req, res);
  if (!modelo) return;

  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: "Formato de fecha inválido. Use YYYY-MM-DD" });
  }

  try {
    const inicioLocal = new Date(`${fecha}T00:00:00-05:00`);
    const finLocal = new Date(`${fecha}T23:59:59.999-05:00`);
    const registros = await modelo
      .find({ timestamp: { $gte: inicioLocal, $lte: finLocal } })
      .sort({ timestamp: 1 });

    const gateways = {};
    const dispositivos = {};

    for (const registro of registros) {
      if (registro.gateways) {
        for (const [id, gw] of Object.entries(registro.gateways)) {
          if (!gateways[id]) {
            gateways[id] = { ip: gw.ip, sectores: gw.sectores, caidasCount: 0, totalMuestras: 0 };
          }
          gateways[id].totalMuestras++;
          if (gw.online === false) gateways[id].caidasCount++;
        }
      }
      if (registro.dispositivos) {
        for (const [grupo, devices] of Object.entries(registro.dispositivos)) {
          if (!dispositivos[grupo]) dispositivos[grupo] = {};
          for (const [nombre, dev] of Object.entries(devices)) {
            if (!dispositivos[grupo][nombre]) {
              dispositivos[grupo][nombre] = { ip: dev.ip, ubicacion: dev.ubicacion, caidasCount: 0, totalMuestras: 0 };
            }
            dispositivos[grupo][nombre].totalMuestras++;
            if (dev.online === false) dispositivos[grupo][nombre].caidasCount++;
          }
        }
      }
    }

    for (const gw of Object.values(gateways)) {
      gw.porcentajeCaida = gw.totalMuestras > 0
        ? Math.round((gw.caidasCount / gw.totalMuestras) * 10000) / 100 : 0;
    }
    for (const grupo of Object.values(dispositivos)) {
      for (const dev of Object.values(grupo)) {
        dev.porcentajeCaida = dev.totalMuestras > 0
          ? Math.round((dev.caidasCount / dev.totalMuestras) * 10000) / 100 : 0;
      }
    }

    res.json({ fecha, totalRegistros: registros.length, gateways, dispositivos });
  } catch {
    res.status(500).json({ error: "Error al consultar caídas" });
  }
});

router.get("/caidas/:fechaInicio/:fechaFin", async (req, res) => {
  const modelo = getModelo(req, res);
  if (!modelo) return;

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
    const registros = await modelo
      .find({ timestamp: { $gte: inicio, $lte: fin } })
      .sort({ timestamp: 1 });

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

    const dias = Object.entries(porDia).map(([fecha, dia]) => {
      for (const gw of Object.values(dia.gateways)) {
        gw.porcentajeCaida = gw.totalMuestras > 0
          ? Math.round((gw.caidasCount / gw.totalMuestras) * 10000) / 100 : 0;
      }
      for (const grupo of Object.values(dia.dispositivos)) {
        for (const dev of Object.values(grupo)) {
          dev.porcentajeCaida = dev.totalMuestras > 0
            ? Math.round((dev.caidasCount / dev.totalMuestras) * 10000) / 100 : 0;
        }
      }
      return { fecha, ...dia };
    });

    res.json({ fechaInicio, fechaFin, dias });
  } catch {
    res.status(500).json({ error: "Error al consultar caídas por rango" });
  }
});

export default router;
