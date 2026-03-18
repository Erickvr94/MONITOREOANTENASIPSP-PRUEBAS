import mongoose from "mongoose";
import logger from "../utils/logger.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/dbSantaPriscila";

export async function connectDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info(`[DB] Conectado a MongoDB: ${MONGODB_URI}`);
  } catch (error) {
    logger.error(`[DB] Error al conectar a MongoDB: ${error.message}`);
    throw error;
  }
}
