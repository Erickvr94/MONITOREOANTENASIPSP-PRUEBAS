import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

/**
 * POST /api/auth/login
 * Body: { username, password } o { email, password }
 */
router.post("/login", async (req, res) => {
  const { username, email, password } = req.body;

  if (!password || (!username && !email)) {
    return res.status(400).json({ error: "Credenciales incompletas" });
  }

  try {
    // Buscar por username o email
    const query = username ? { username } : { email };
    const user = await User.findOne(query);

    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
