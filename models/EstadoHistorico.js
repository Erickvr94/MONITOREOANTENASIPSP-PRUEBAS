import mongoose from "mongoose";

const estadoHistoricoSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true, index: true },
    gateways: { type: mongoose.Schema.Types.Mixed, required: true },
    dispositivos: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: false },
);

export const EstadoHistorico = mongoose.model(
  "IPSPEstadosHistorico",
  estadoHistoricoSchema,
);
