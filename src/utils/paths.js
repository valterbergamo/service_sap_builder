const path = require('path');
const fs = require('fs/promises');

const BASE_DIR = path.resolve(process.cwd(), process.env.PROJECTS_BASE_DIR || './projects');

function isValidProjectId(id) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

function resolveProjectPath(projectId) {
  const target = path.resolve(BASE_DIR, projectId);
  if (!target.startsWith(BASE_DIR + path.sep) && target !== BASE_DIR) {
    throw new Error('Invalid path resolution');
  }
  return target;
}

// ✅ Novo: checa se "target" está DENTRO de "base" (ou é igual)
function isInsidePath(base, target) {
  const rel = path.relative(base, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel); // inclui igualdade (rel === '')
}

async function ensureBaseDir() {
  await fs.mkdir(BASE_DIR, { recursive: true });
}

module.exports = {
  BASE_DIR,
  isValidProjectId,
  resolveProjectPath,
  ensureBaseDir,
  isInsidePath // <= exporte isto
};
