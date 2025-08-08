const path = require('path');
const fs = require('fs/promises');

const BASE_DIR = path.resolve(process.cwd(), process.env.PROJECTS_BASE_DIR || './projects');

function isValidProjectId(id) {
  // Apenas letras, números, hífen e sublinhado. (ajuste se quiser permitir mais)
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

function resolveProjectPath(projectId) {
  const target = path.resolve(BASE_DIR, projectId);
  // Garante que não “escape” do BASE_DIR (proteção a path traversal)
  if (!target.startsWith(BASE_DIR + path.sep)) {
    throw new Error('Invalid path resolution');
  }
  return target;
}

async function ensureBaseDir() {
  await fs.mkdir(BASE_DIR, { recursive: true });
}

module.exports = {
  BASE_DIR,
  isValidProjectId,
  resolveProjectPath,
  ensureBaseDir
};
