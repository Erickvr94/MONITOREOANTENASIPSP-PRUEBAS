import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

/**
 * POST /api/users
 * Crea un nuevo usuario. Solo accesible con rol "master".
 * Header: Authorization: Bearer <token>
 * Body: { username, email, name, password, role }
 */
router.post("/", requireAuth, requireRole("master"), async (req, res) => {
  const { username, email, name, password, role } = req.body;

  if (!username || !email || !name || !password) {
    return res.status(400).json({ error: "username, email, name y password son obligatorios" });
  }

  try {
    const existe = await User.findOne({ $or: [{ username }, { email }] });
    if (existe) {
      return res.status(409).json({ error: "El username o email ya está en uso" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const usuario = await User.create({
      username,
      email,
      name,
      password: hashedPassword,
      role: role || "user",
    });

    res.status(201).json({
      id: usuario._id,
      username: usuario.username,
      email: usuario.email,
      name: usuario.name,
      role: usuario.role,
    });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
