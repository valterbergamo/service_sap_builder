const { Router } = require('express');
const fs = require('fs/promises');
const path = require('path');
const { z } = require('zod');
const { spawn } = require('child_process');
const { isValidProjectId, resolveProjectPath, ensureBaseDir, BASE_DIR } = require('../utils/paths');

const router = Router();

const createProjectBody = z.object({
	id: z.string().min(1).max(64),
	meta: z.record(z.any()).optional(),
	template: z.string().optional(),
	namespace: z.string().min(1).optional() // Novo campo para namespace
});

// GET /projects -> lista todos os projetos
router.get('/', async (req, res, next) => {
	try {
		await ensureBaseDir();
		const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
		const projects = [];

		for (const entry of entries) {
			if (entry.isDirectory()) {
				const projectPath = path.join(BASE_DIR, entry.name);
				const metaPath = path.join(projectPath, 'project.json');
				
				let meta = null;
				try {
					const metaContent = await fs.readFile(metaPath, 'utf8');
					meta = JSON.parse(metaContent);
				} catch (e) {
					// Se não tem project.json, ignora
				}

				projects.push({
					id: entry.name,
					path: projectPath,
					meta
				});
			}
		}

		res.json(projects);
	} catch (err) {
		next(err);
	}
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

		const { id, meta, template, namespace } = parsed.data;
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

		// Se um template foi especificado, copiar os arquivos do template
		if (template) {
			const templatesDir = path.join(__dirname, '../../templates');
			const templatePath = path.join(templatesDir, template);
			
			try {
				// Verificar se o template existe
				const templateStat = await fs.stat(templatePath);
				if (!templateStat.isDirectory()) {
					return res.status(400).json({
						error: `Template '${template}' não é um diretório válido`
					});
				}

				// Copiar arquivos do template para o projeto com substituições
				const targetNamespace = namespace || id; // Se não fornecido, usa o ID
				await copyDirectory(templatePath, projectPath, targetNamespace);
			} catch (e) {
				if (e.code === 'ENOENT') {
					return res.status(400).json({
						error: `Template '${template}' não encontrado`
					});
				}
				throw e;
			}
		}

		if (meta && typeof meta === 'object') {
			const metaPath = path.join(projectPath, 'project.json');
			const projectData = { 
				id, 
				meta, 
				template: template || null,
				namespace: namespace || id,
				createdAt: new Date().toISOString() 
			};
			await fs.writeFile(
				metaPath,
				JSON.stringify(projectData, null, 2)
			);
		}

		return res.status(created ? 201 : 200).json({
			id,
			baseDir: BASE_DIR,
			path: projectPath,
			template: template || null,
			namespace: namespace || id,
			created
		});
	} catch (err) {
		next(err);
	}
});

// GET /projects/:id/tree -> árvore de arquivos do projeto
router.get('/:id/tree', async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		const projectPath = resolveProjectPath(id);
		
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		const tree = await buildFileTree(projectPath);
		res.json({ id, tree });
	} catch (err) {
		next(err);
	}
});

// POST /projects/:id/docker/start -> inicia container do projeto
router.post('/:id/docker/start', async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		const projectPath = resolveProjectPath(id);
		
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Executar docker-compose up
		const result = await executeDockerCommand(projectPath, ['up', '-d']);
		
		res.json({
			id,
			action: 'start',
			success: result.success,
			output: result.output,
			error: result.error
		});
	} catch (err) {
		next(err);
	}
});

// POST /projects/:id/docker/stop -> para container do projeto
router.post('/:id/docker/stop', async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		const projectPath = resolveProjectPath(id);
		
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Executar docker-compose down
		const result = await executeDockerCommand(projectPath, ['down']);
		
		res.json({
			id,
			action: 'stop',
			success: result.success,
			output: result.output,
			error: result.error
		});
	} catch (err) {
		next(err);
	}
});

// GET /projects/:id/docker/status -> status do container do projeto
router.get('/:id/docker/status', async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		const projectPath = resolveProjectPath(id);
		
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Executar docker-compose ps
		const result = await executeDockerCommand(projectPath, ['ps', '--format', 'json']);
		
		let containers = [];
		if (result.success && result.output) {
			try {
				// Parse do output JSON
				const lines = result.output.trim().split('\n').filter(line => line.trim());
				containers = lines.map(line => JSON.parse(line));
			} catch (e) {
				// Se falhar o parse, retorna output raw
			}
		}

		res.json({
			id,
			containers,
			raw_output: result.output,
			success: result.success,
			error: result.error
		});
	} catch (err) {
		next(err);
	}
});

// Função auxiliar para executar comandos docker-compose
function executeDockerCommand(projectPath, args) {
	return new Promise((resolve) => {
		const child = spawn('docker-compose', args, {
			cwd: projectPath,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			resolve({
				success: code === 0,
				output: stdout,
				error: stderr,
				exitCode: code
			});
		});

		child.on('error', (err) => {
			resolve({
				success: false,
				output: '',
				error: err.message,
				exitCode: -1
			});
		});
	});
}

// Função auxiliar para construir árvore de arquivos
async function buildFileTree(dirPath, relativePath = '') {
	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	const tree = [];

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		const relPath = path.join(relativePath, entry.name);

		if (entry.isDirectory()) {
			const children = await buildFileTree(fullPath, relPath);
			tree.push({
				name: entry.name,
				type: 'directory',
				path: relPath,
				children
			});
		} else {
			const stats = await fs.stat(fullPath);
			tree.push({
				name: entry.name,
				type: 'file',
				path: relPath,
				size: stats.size,
				modified: stats.mtime
			});
		}
	}

	return tree.sort((a, b) => {
		// Diretórios primeiro, depois arquivos
		if (a.type !== b.type) {
			return a.type === 'directory' ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

// Função auxiliar para copiar diretório recursivamente com substituições
async function copyDirectory(src, dest, namespace = null) {
	const entries = await fs.readdir(src, { withFileTypes: true });
	
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		
		if (entry.isDirectory()) {
			await fs.mkdir(destPath, { recursive: true });
			await copyDirectory(srcPath, destPath, namespace);
		} else if (entry.isFile()) {
			// Se namespace fornecido, fazer substituições em arquivos de texto
			if (namespace && isTextFile(entry.name)) {
				await copyFileWithSubstitution(srcPath, destPath, namespace);
			} else {
				await fs.copyFile(srcPath, destPath);
			}
		}
	}
}

// Função para verificar se é arquivo de texto
function isTextFile(filename) {
	const textExtensions = ['.js', '.json', '.xml', '.html', '.yaml', '.yml', '.properties'];
	return textExtensions.some(ext => filename.endsWith(ext));
}

// Função para copiar arquivo com substituições
async function copyFileWithSubstitution(srcPath, destPath, namespace) {
	let content = await fs.readFile(srcPath, 'utf8');
	
	// Substituir todas as ocorrências de builder.fsc.service pelo namespace
	content = content.replace(/builder\.fsc\.service/g, namespace);
	
	await fs.writeFile(destPath, content, 'utf8');
}

// GET /projects/:id/files -> ler conteúdo de arquivo
router.get('/:id/files', async (req, res, next) => {
	try {
		const { id } = req.params;
		const { filepath, encoding = 'utf8' } = req.query;

		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		if (!filepath) {
			return res.status(400).json({ error: 'Parâmetro filepath é obrigatório' });
		}

		const projectPath = resolveProjectPath(id);
		const fullFilePath = path.join(projectPath, filepath);

		// Verificar se o projeto existe
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Verificar se o arquivo está dentro do projeto (segurança)
		if (!fullFilePath.startsWith(projectPath)) {
			return res.status(400).json({ error: 'Caminho de arquivo inválido' });
		}

		// Verificar se o arquivo existe
		try {
			await fs.access(fullFilePath);
		} catch (e) {
			return res.status(404).json({ error: 'Arquivo não encontrado' });
		}

		// Ler o arquivo
		const content = await fs.readFile(fullFilePath, encoding);
		const stats = await fs.stat(fullFilePath);

		res.json({
			id,
			filepath,
			content,
			encoding,
			size: stats.size,
			modified: stats.mtime
		});
	} catch (err) {
		next(err);
	}
});

// POST /projects/:id/files -> criar/editar arquivo
router.post('/:id/files', async (req, res, next) => {
	try {
		const { id } = req.params;
		const { filepath, content, encoding = 'utf8' } = req.body;

		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		if (!filepath) {
			return res.status(400).json({ error: 'Campo filepath é obrigatório' });
		}

		if (content === undefined) {
			return res.status(400).json({ error: 'Campo content é obrigatório' });
		}

		const projectPath = resolveProjectPath(id);
		const fullFilePath = path.join(projectPath, filepath);

		// Verificar se o projeto existe
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Verificar se o arquivo está dentro do projeto (segurança)
		if (!fullFilePath.startsWith(projectPath)) {
			return res.status(400).json({ error: 'Caminho de arquivo inválido' });
		}

		// Criar diretórios pai se necessário
		const dirPath = path.dirname(fullFilePath);
		await fs.mkdir(dirPath, { recursive: true });

		// Verificar se arquivo já existe
		let existed = false;
		try {
			await fs.access(fullFilePath);
			existed = true;
		} catch (e) {
			// Arquivo não existe, será criado
		}

		// Escrever o arquivo
		await fs.writeFile(fullFilePath, content, encoding);
		const stats = await fs.stat(fullFilePath);

		res.status(existed ? 200 : 201).json({
			id,
			filepath,
			created: !existed,
			size: stats.size,
			modified: stats.mtime,
			encoding
		});
	} catch (err) {
		next(err);
	}
});

// DELETE /projects/:id/files -> deletar arquivo
router.delete('/:id/files', async (req, res, next) => {
	try {
		const { id } = req.params;
		const { filepath } = req.query;

		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		if (!filepath) {
			return res.status(400).json({ error: 'Parâmetro filepath é obrigatório' });
		}

		const projectPath = resolveProjectPath(id);
		const fullFilePath = path.join(projectPath, filepath);

		// Verificar se o projeto existe
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Verificar se o arquivo está dentro do projeto (segurança)
		if (!fullFilePath.startsWith(projectPath)) {
			return res.status(400).json({ error: 'Caminho de arquivo inválido' });
		}

		// Verificar se o arquivo existe
		try {
			await fs.access(fullFilePath);
		} catch (e) {
			return res.status(404).json({ error: 'Arquivo não encontrado' });
		}

		// Deletar o arquivo
		await fs.unlink(fullFilePath);

		res.json({
			id,
			filepath,
			deleted: true
		});
	} catch (err) {
		next(err);
	}
});

// DELETE /projects/:id/folders -> deletar pasta (vazia ou com conteúdo)
router.delete('/:id/folders', async (req, res, next) => {
	try {
		const { id } = req.params;
		const { folderpath } = req.query;

		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		if (!folderpath) {
			return res.status(400).json({ error: 'Parâmetro folderpath é obrigatório' });
		}

		const projectPath = resolveProjectPath(id);
		const fullFolderPath = path.join(projectPath, folderpath);

		// Verificar se o projeto existe
		try {
			await fs.access(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Verificar se a pasta está dentro do projeto (segurança)
		if (!fullFolderPath.startsWith(projectPath)) {
			return res.status(400).json({ error: 'Caminho de pasta inválido' });
		}

		// Não permitir deletar a pasta raiz do projeto
		if (fullFolderPath === projectPath) {
			return res.status(400).json({ error: 'Não é possível deletar a pasta raiz do projeto' });
		}

		// Verificar se a pasta existe
		let folderStats;
		try {
			folderStats = await fs.stat(fullFolderPath);
		} catch (e) {
			return res.status(404).json({ error: 'Pasta não encontrada' });
		}

		// Verificar se é realmente uma pasta
		if (!folderStats.isDirectory()) {
			return res.status(400).json({ error: 'O caminho especificado não é uma pasta' });
		}

		// Deletar a pasta recursivamente (com todo o conteúdo)
		await fs.rm(fullFolderPath, { recursive: true, force: true });

		res.json({
			id,
			folderpath,
			deleted: true,
			message: 'Pasta deletada com sucesso (incluindo todo o conteúdo)'
		});
	} catch (err) {
		next(err);
	}
});

// DELETE /projects/:id -> deletar projeto inteiro
router.delete('/:id', async (req, res, next) => {
	try {
		const { id } = req.params;

		if (!isValidProjectId(id)) {
			return res.status(400).json({ error: 'ID de projeto inválido' });
		}

		const projectPath = resolveProjectPath(id);

		// Verificar se o projeto existe
		let projectStats;
		try {
			projectStats = await fs.stat(projectPath);
		} catch (e) {
			return res.status(404).json({ error: 'Projeto não encontrado' });
		}

		// Verificar se é realmente uma pasta
		if (!projectStats.isDirectory()) {
			return res.status(400).json({ error: 'Caminho do projeto não é uma pasta válida' });
		}

		// Antes de deletar, tentar parar containers Docker se existirem
		try {
			const dockerResult = await executeDockerCommand(projectPath, ['down', '--remove-orphans']);
			console.log(`Docker containers parados para projeto ${id}:`, dockerResult.output);
		} catch (dockerErr) {
			// Se falhar, continua mesmo assim (pode não ter Docker)
			console.warn(`Aviso: Não foi possível parar containers Docker para projeto ${id}:`, dockerErr.message);
		}

		// Deletar o projeto inteiro recursivamente
		await fs.rm(projectPath, { recursive: true, force: true });

		res.json({
			id,
			deleted: true,
			path: projectPath,
			message: 'Projeto deletado com sucesso (incluindo containers Docker)'
		});
	} catch (err) {
		next(err);
	}
});

module.exports = router;
