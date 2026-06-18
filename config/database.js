import mongoose from "mongoose";
import logger from "../utils/logger.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/monitoreo";

export async function connectDatabase() {
  const conn = await mongoose.createConnection(MONGODB_URI).asPromise();
  logger.info(`[DB] Conectado: ${MONGODB_URI}`);
  return conn;
}
