import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true, expires: "90d" },
    gateways: { type: mongoose.Schema.Types.Mixed, required: true },
    dispositivos: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: false },
);

export function crearModeloEstadoHistorico(connection, fincaId) {
  const coleccion = `ipsp_${fincaId}_estados_historicos`;
  return connection.model(`EstadoHistorico_${fincaId}`, schema, coleccion);
}
