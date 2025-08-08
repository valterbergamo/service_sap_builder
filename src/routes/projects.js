const { Router } = require('express');
const fs = require('fs/promises');
const path = require('path');
const { z } = require('zod');
const { isValidProjectId, resolveProjectPath, ensureBaseDir, BASE_DIR } = require('../utils/paths');

const router = Router();

const createProjectBody = z.object({
	id: z.string().min(1).max(64),
	meta: z.record(z.any()).optional()
});

// POST /projects -> cria projects/{id}
router.post('/', async (req, res, next) => {
	try {
		await ensureBaseDir();

		const parsed = createProjectBody.safeParse(req.body);
		if (!parsed.success) {
			return res
				.status(400)
				.json({ error: 'Payload inválido', details: parsed.error.flatten() });
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
			if (e.code !== 'EEXIST') throw e;
		}

		if (meta && typeof meta === 'object') {
			const metaPath = path.join(projectPath, 'project.json');
			await fs.writeFile(
				metaPath,
				JSON.stringify({ id, meta, createdAt: new Date().toISOString() }, null, 2)
			);
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

/* =============================
 *  NOVO: salvar arquivo
 * ============================= */

// schema do corpo
const saveFileBody = z.object({
	filepath: z.string().min(1), // ex: "src/index.html" ou "srv/app.js"
	content: z.string().default(''), // conteúdo em texto OU base64
	encoding: z.enum(['utf8', 'base64']).default('utf8'),
	overwrite: z.boolean().default(true), // se false, retorna 409 se já existir
	mode: z
		.string()
		.regex(/^[0-7]{3,4}$/)
		.optional() // permissões tipo "644" ou "0644"
});

// POST /projects/:id/files -> grava arquivo em projects/:id/<filepath>
router.post('/:id/files', async (req, res, next) => {
	try {
		await ensureBaseDir();

		const { id } = req.params;

		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'project id inválido' });
		}

		const parsed = saveFileBody.safeParse(req.body);
		if (!parsed.success) {
			return res
				.status(400)
				.json({ error: 'Payload inválido', details: parsed.error.flatten() });
		}

		const { filepath, content, encoding, overwrite, mode } = parsed.data;

		// caminho do projeto
		const projectPath = resolveProjectPath(id);

		// projeto precisa existir
		try {
			const stat = await fs.stat(projectPath);
			if (!stat.isDirectory()) throw new Error('Caminho do projeto não é diretório');
		} catch (e) {
			if (e.code === 'ENOENT') {
				return res
					.status(404)
					.json({ error: 'Projeto não encontrado. Crie primeiro via POST /projects' });
			}
			throw e;
		}

		// resolve caminho do arquivo dentro do projeto
		const targetPath = path.resolve(projectPath, filepath);

		// proteção contra path traversal
		const { isInsidePath } = require('../utils/paths');
		if (!isInsidePath(projectPath, targetPath)) {
			return res.status(400).json({ error: 'caminho inválido (fora do diretório do projeto)' });
		}

		// cria diretório pai
		const dir = path.dirname(targetPath);
		await fs.mkdir(dir, { recursive: true });

		// se não pode sobrescrever e arquivo existe -> 409
		if (!overwrite) {
			try {
				await fs.stat(targetPath);
				return res.status(409).json({ error: 'Arquivo já existe e overwrite=false' });
			} catch (e) {
				if (e.code !== 'ENOENT') throw e; // se outro erro, propaga
			}
		}

		// converte conteúdo conforme encoding
		const buffer =
			encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');

		// grava
		await fs.writeFile(targetPath, buffer);

		// aplica permissões se fornecido
		if (mode) {
			await fs.chmod(targetPath, parseInt(mode, 8));
		}

		return res.status(201).json({
			projectId: id,
			filepath,
			absolutePath: targetPath,
			size: buffer.length,
			overwritten: overwrite
		});
	} catch (err) {
		next(err);
	}
});

// ... imports já existentes ...
const { URLSearchParams } = require('url');

// =============================
// GET /projects/:id/files
//  - Lê um arquivo dentro do projeto
//  - Query params:
//      filepath   (obrigatório) ex: src/index.html
//      encoding   (opcional) 'utf8' | 'base64' (default: 'utf8') -> forma do retorno no JSON
//      download   (opcional) 'true'|'false' (default: 'false') -> se true, faz download binário
// =============================
router.get('/:id/files', async (req, res, next) => {
	try {
		await ensureBaseDir();

		const { id } = req.params;
		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'project id inválido' });
		}

		const qp = new URLSearchParams(req.query);
		const filepath = qp.get('filepath');
		const encoding = (qp.get('encoding') || 'utf8').toLowerCase();
		const download = (qp.get('download') || 'false').toLowerCase() === 'true';

		if (!filepath) {
			return res.status(400).json({ error: 'Parâmetro "filepath" é obrigatório' });
		}
		if (!['utf8', 'base64'].includes(encoding)) {
			return res.status(400).json({ error: 'encoding inválido. Use utf8 ou base64' });
		}

		const projectPath = resolveProjectPath(id);
		const targetPath = path.resolve(projectPath, filepath);
    const { isInsidePath } = require('../utils/paths');

    if (!isInsidePath(projectPath, targetPath)) {
      return res.status(400).json({ error: 'caminho inválido (fora do diretório do projeto)' });
    }
    
		
		const stat = await fs.stat(targetPath).catch(() => null);
		if (!stat || !stat.isFile()) {
			return res.status(404).json({ error: 'Arquivo não encontrado' });
		}

		if (download) {
			// envia binário para download
			return res.download(targetPath);
		}

		// retorna conteúdo no JSON
		const buffer = await fs.readFile(targetPath);
		const content = encoding === 'base64' ? buffer.toString('base64') : buffer.toString('utf8');

		return res.json({
			projectId: id,
			filepath,
			size: stat.size,
			mtime: stat.mtime,
			encoding,
			content
		});
	} catch (err) {
		next(err);
	}
});

// =============================
// DELETE /projects/:id/files
//  - Remove um arquivo (ou diretório) dentro do projeto
//  - Query params:
//      filepath    (obrigatório)
//      recursive   (opcional) 'true'|'false' (default: 'false')
// =============================
router.delete('/:id/files', async (req, res, next) => {
	try {
		await ensureBaseDir();

		const { id } = req.params;
		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'project id inválido' });
		}

		const qp = new URLSearchParams(req.query);
		const filepath = qp.get('filepath');
		const recursive = (qp.get('recursive') || 'false').toLowerCase() === 'true';

		if (!filepath) {
			return res.status(400).json({ error: 'Parâmetro "filepath" é obrigatório' });
		}

		const projectPath = resolveProjectPath(id);
		const targetPath = path.resolve(projectPath, filepath);

		if (!targetPath.startsWith(projectPath + path.sep)) {
			return res.status(400).json({ error: 'filepath inválido (fora do diretório do projeto)' });
		}

		const stat = await fs.stat(targetPath).catch(() => null);
		if (!stat) {
			return res.status(404).json({ error: 'Arquivo ou diretório não encontrado' });
		}

		if (stat.isDirectory()) {
			if (!recursive) {
				return res
					.status(400)
					.json({ error: 'É um diretório. Use recursive=true para remover recursivamente.' });
			}
			// remove diretório recursivo
			await fs.rm(targetPath, { recursive: true, force: true });
			return res.status(200).json({ projectId: id, filepath, deleted: true, type: 'directory' });
		}

		// remove arquivo
		await fs.unlink(targetPath);
		return res.status(200).json({ projectId: id, filepath, deleted: true, type: 'file' });
	} catch (err) {
		next(err);
	}
});

// -------- helper: monta árvore ----------
async function buildTree(rootAbs, relBase = '', depth = 3) {
	const out = [];
	const entries = await fs.readdir(path.resolve(rootAbs, relBase), { withFileTypes: true });

	for (const e of entries) {
		const relPath = path.posix.join(relBase.replace(/\\/g, '/'), e.name);
		const absPath = path.resolve(rootAbs, relPath);
		const st = await fs.stat(absPath);

		if (e.isDirectory()) {
			const node = {
				type: 'dir',
				name: e.name,
				path: relPath,
				size: 0,
				mtime: st.mtime,
				children: []
			};
			if (depth > 0) {
				node.children = await buildTree(rootAbs, relPath, depth - 1);
				node.size = node.children.reduce((acc, c) => acc + (c.size || 0), 0);
			}
			out.push(node);
		} else if (e.isFile()) {
			out.push({
				type: 'file',
				name: e.name,
				path: relPath,
				size: st.size,
				mtime: st.mtime
			});
		}
		// (symlink/outros ignorados por simplicidade)
	}
	// ordena: dirs primeiro, depois arquivos; por nome
	out.sort((a, b) =>
		a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
	);
	return out;
}

// =============================
// GET /projects/:id/tree
// Query:
//   dir    (opcional) subpasta relativa; default = "" (raiz do projeto)
//   depth  (opcional) int >= 0; default = 5
// =============================
router.get('/:id/tree', async (req, res, next) => {
	try {
		await ensureBaseDir();
		const { id } = req.params;
		if (!isValidProjectId(id)) return res.status(400).json({ error: 'project id inválido' });

		const projectPath = resolveProjectPath(id);
		const dirRel = String(req.query.dir || '');
		const depth = Math.max(0, parseInt(req.query.depth ?? '5', 10) || 0);

		// Logs de debug para identificar o problema
		console.log('=== DEBUG TREE ROUTE ===');
		console.log('Project ID:', id);
		console.log('Project Path:', projectPath);
		console.log('Dir Rel:', dirRel);
		console.log('BASE_DIR:', BASE_DIR);

		const targetPath = path.resolve(projectPath, dirRel);
		console.log('Target Path:', targetPath);
		console.log('Project Path + sep:', projectPath + path.sep);
		console.log('Target starts with project path?', targetPath.startsWith(projectPath + path.sep));
		console.log('Target equals project path?', targetPath === projectPath);

		// Corrigir a validação para permitir quando targetPath é igual ao projectPath
		if (!targetPath.startsWith(projectPath + path.sep) && targetPath !== projectPath) {
			console.log('❌ Validation failed - path outside project');
			return res.status(400).json({ error: 'dir inválido (fora do diretório do projeto)' });
		}

		const st = await fs.stat(projectPath).catch(() => null);
		if (!st || !st.isDirectory()) {
			console.log('❌ Project directory not found');
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		const stDir = await fs.stat(targetPath).catch(() => null);
		if (!stDir || !stDir.isDirectory()) {
			console.log('❌ Target directory not found');
			return res.status(404).json({ error: 'Diretório não encontrado' });
		}

		console.log('✅ All validations passed, building tree...');
		const tree = await buildTree(projectPath, dirRel, depth);
		console.log('✅ Tree built successfully');
		
		return res.json({
			projectId: id,
			baseDir: dirRel || '',
			depth,
			items: tree
		});
	} catch (err) {
		console.log('❌ Error in tree route:', err);
		next(err);
	}
});



module.exports = router;
