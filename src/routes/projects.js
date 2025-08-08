const { Router } = require('express');
const fs = require('fs/promises');
const { z } = require('zod');
const { isValidProjectId, resolveProjectPath, ensureBaseDir, BASE_DIR } = require('../utils/paths');

const router = Router();

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  // opcional: já pensando no futuro, você pode enviar metadados
  meta: z.record(z.any()).optional()
});

// POST /projects -> cria projects/{id}
router.post('/', async (req, res, next) => {
  try {
    await ensureBaseDir();

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
    }

    const { id, meta } = parsed.data;

    if (!isValidProjectId(id)) {
      return res.status(400).json({
        error: 'id inválido. Use apenas letras, números, hífen e sublinhado (1–64 chars).'
      });
    }

    const projectPath = resolveProjectPath(id);

    let created = false;
    try {
      await fs.mkdir(projectPath, { recursive: false });
      created = true;
    } catch (e) {
      // Se já existir, não é erro — tornamos idempotente
      if (e.code !== 'EEXIST') throw e;
    }

    // Se vier meta, salva um arquivo de metadados
    if (meta && typeof meta === 'object') {
      const metaPath = `${projectPath}/project.json`;
      await fs.writeFile(metaPath, JSON.stringify({ id, meta, createdAt: new Date().toISOString() }, null, 2));
    }

    return res.status(created ? 201 : 200).json({
      id,
      baseDir: BASE_DIR,
      path: projectPath,
      created
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
