const { Router } = require('express');
const { z } = require('zod');
const { 
	saveEmbedding, 
	searchSimilar,
	searchSimilarWithTranslation,
	searchWithProgressiveThreshold,
	saveUserPrompt, 
	saveSAPDocumentation,
	processDocumentWithChunking,
	getDocumentChunks
} = require('../services/embeddings');

const router = Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configuração do multer para upload de arquivos
const storage = multer.memoryStorage();
const upload = multer({
	storage: storage,
	limits: {
		fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024 // 10MB default
	},
	fileFilter: (req, file, cb) => {
		const allowedTypes = ['.txt', '.pdf', '.docx', '.md'];
		const fileExt = path.extname(file.originalname).toLowerCase();
		
		if (allowedTypes.includes(fileExt)) {
			cb(null, true);
		} else {
			cb(new Error(`Tipo de arquivo não suportado: ${fileExt}. Tipos permitidos: ${allowedTypes.join(', ')}`));
		}
	}
});

// Schemas de validação atualizados com suporte a idioma
const generateEmbeddingSchema = z.object({
	content: z.string().min(1).max(8000),
	contentType: z.enum(['prompt', 'source_code', 'template', 'documentation']),
	metadata: z.record(z.any()).optional().default({}),
	language: z.string().min(2).max(5).optional().default('en') // Novo campo
});

const searchSchema = z.object({
	query: z.string().min(1).max(1000),
	contentType: z.enum(['prompt', 'source_code', 'template', 'documentation']).optional(),
	limit: z.string().transform(val => parseInt(val)).pipe(z.number().int().min(1).max(50)).optional().default(10),
	threshold: z.string().transform(val => parseFloat(val)).pipe(z.number().min(0).max(3)).optional().default(1.5),
	language: z.string().min(2).max(5).optional().default('auto') // Novo campo
});

// Schema para upload de documentos SAP - ajustado para os novos campos
const uploadDocumentSchema = z.object({
	docTitle: z.string().min(1).max(255),
	docUrl: z.string().url(),
	sapClass: z.string().min(1).max(100),
	sapComponent: z.string().min(1).max(100),
	docSection: z.string().min(1).max(100),
	language: z.string().min(2).max(5).optional().default('auto'),
	searchMetadata: z.string().optional() // Novo campo para JSON de metadados
});

// POST /embeddings/upload-document -> Upload e processamento de documentos SAP
router.post('/upload-document', upload.single('document'), async (req, res, next) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
		}

		// Validar dados do formulário
		const parsed = uploadDocumentSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ 
				error: 'Dados do formulário inválidos', 
				details: parsed.error.flatten() 
			});
		}

		const { docTitle, docUrl, sapClass, sapComponent, docSection, language, searchMetadata } = parsed.data;
		const file = req.file;

		// Processar searchMetadata se fornecido
		let parsedSearchMetadata = {};
		if (searchMetadata && searchMetadata.trim()) {
			try {
				parsedSearchMetadata = JSON.parse(searchMetadata);
			} catch (error) {
				return res.status(400).json({ 
					error: 'searchMetadata deve ser um JSON válido',
					details: error.message
				});
			}
		}

		// Extrair conteúdo do arquivo baseado no tipo
		let content = '';
		const fileExt = path.extname(file.originalname).toLowerCase();

		if (fileExt === '.txt' || fileExt === '.md') {
			content = file.buffer.toString('utf-8');
		} else if (fileExt === '.pdf') {
			return res.status(400).json({ 
				error: 'Suporte a PDF ainda não implementado. Use arquivos .txt ou .md por enquanto.' 
			});
		} else if (fileExt === '.docx') {
			return res.status(400).json({ 
				error: 'Suporte a DOCX ainda não implementado. Use arquivos .txt ou .md por enquanto.' 
			});
		}

		if (!content || content.trim().length === 0) {
			return res.status(400).json({ error: 'Arquivo está vazio ou não pôde ser lido' });
		}

		// Montar metadata no formato especificado
		const metadata = {
			docTitle,
			docUrl,
			sapClass,
			sapComponent,
			docSection,
			searchMetadata: parsedSearchMetadata // Incluir metadados de busca
		};

		// Processar documento com chunking
		const result = await processDocumentWithChunking(
			content,
			docTitle,
			'sap_documentation',
			sapComponent,
			language,
			metadata
		);

		res.status(201).json({
			success: true,
			documentId: result.documentId,
			originalLanguage: result.language,
			wasTranslated: result.wasTranslated,
			totalChunks: result.chunksCreated,
			fileSize: file.size,
			fileType: fileExt,
			metadata,
			message: `Documento SAP processado com sucesso em ${result.chunksCreated} chunks`
		});

	} catch (err) {
		console.error('❌ Erro no upload de documento:', err);
		next(err);
	}
});

// GET /embeddings/documents/:documentId/chunks -> Listar chunks de um documento
router.get('/documents/:documentId/chunks', async (req, res, next) => {
	try {
		const documentId = parseInt(req.params.documentId);
		
		if (isNaN(documentId)) {
			return res.status(400).json({ error: 'ID do documento deve ser um número' });
		}

		const chunks = await getDocumentChunks(documentId);
		
		res.json({
			documentId,
			totalChunks: chunks.length,
			chunks: chunks.map(chunk => ({
				id: chunk.id,
				chunkIndex: chunk.chunkIndex,
				content: chunk.content,
				wasTranslated: chunk.wasTranslated,
				createdAt: chunk.createdAt
			}))
		});

	} catch (err) {
		next(err);
	}
});

// POST /embeddings/generate -> Gerar e salvar embedding com tradução
router.post('/generate', async (req, res, next) => {
	try {
		const parsed = generateEmbeddingSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ 
				error: 'Payload inválido', 
				details: parsed.error.flatten() 
			});
		}

		const { content, contentType, metadata, language } = parsed.data;
		
		const embeddingId = await saveEmbedding(content, contentType, metadata, language);
		
		res.status(201).json({
			id: embeddingId,
			contentType,
			contentLength: content.length,
			language,
			wasTranslated: language !== 'en',
			message: 'Embedding gerado e salvo com sucesso'
		});
	} catch (err) {
		next(err);
	}
});

// GET /embeddings/search -> Busca semântica com tradução automática
router.get('/search', async (req, res, next) => {
	try {
		// Converter query params manualmente
		const searchParams = {
			query: req.query.query,
			contentType: req.query.contentType,
			limit: req.query.limit ? parseInt(req.query.limit) : 10,
			threshold: req.query.threshold ? parseFloat(req.query.threshold) : 1.5,
			language: req.query.language || 'auto'
		};

		// Validação simples
		if (!searchParams.query || searchParams.query.length === 0) {
			return res.status(400).json({ error: 'Query é obrigatório' });
		}

		if (searchParams.limit < 1 || searchParams.limit > 50) {
			return res.status(400).json({ error: 'Limit deve estar entre 1 e 50' });
		}

		if (searchParams.threshold < 0 || searchParams.threshold > 3) {
			return res.status(400).json({ error: 'Threshold deve estar entre 0 e 3' });
		}

		const { query, contentType, limit, threshold, language } = searchParams;
		
		// Usar nova função com tradução automática
		const searchResult = await searchSimilarWithTranslation(query, contentType, limit, threshold, language);
		
		res.json({
			success: true,
			...searchResult
		});
	} catch (err) {
		next(err);
	}
});

// GET /embeddings/search-smart -> Busca inteligente com thresholds progressivos
router.get('/search-smart', async (req, res, next) => {
	try {
		const searchParams = {
			query: req.query.query,
			contentType: req.query.contentType,
			limit: req.query.limit ? parseInt(req.query.limit) : 10,
			language: req.query.language || 'auto',
			maxDistance: req.query.maxDistance ? parseFloat(req.query.maxDistance) : 0.8 // ← NOVO PARÂMETRO
		};

		if (!searchParams.query || searchParams.query.length === 0) {
			return res.status(400).json({ error: 'Query é obrigatório' });
		}

		if (searchParams.limit < 1 || searchParams.limit > 50) {
			return res.status(400).json({ error: 'Limit deve estar entre 1 e 50' });
		}

		// ← VALIDAÇÃO DO maxDistance
		if (searchParams.maxDistance < 0 || searchParams.maxDistance > 1) {
			return res.status(400).json({ error: 'maxDistance deve estar entre 0 e 1' });
		}

		const { query, contentType, limit, language, maxDistance } = searchParams;
		
		const searchResult = await searchWithProgressiveThreshold(query, contentType, limit, language, maxDistance);
		
		res.json({
			success: true,
			...searchResult
		});
	} catch (err) {
		next(err);
	}
});

// GET /embeddings/search-simple -> Busca sem tradução (compatibilidade)
router.get('/search-simple', async (req, res, next) => {
	try {
		const searchParams = {
			query: req.query.query,
			contentType: req.query.contentType,
			limit: req.query.limit ? parseInt(req.query.limit) : 10,
			threshold: req.query.threshold ? parseFloat(req.query.threshold) : 1.5
		};

		if (!searchParams.query) {
			return res.status(400).json({ error: 'Query é obrigatório' });
		}

		const { query, contentType, limit, threshold } = searchParams;
		const results = await searchSimilar(query, contentType, limit, threshold);
		
		res.json({
			query,
			contentType,
			limit,
			threshold,
			resultsCount: results.length,
			results
		});
	} catch (err) {
		next(err);
	}
});

// POST /embeddings/prompts -> Salvar prompt do usuário com tradução
router.post('/prompts', async (req, res, next) => {
	try {
		const parsed = savePromptSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ 
				error: 'Payload inválido', 
				details: parsed.error.flatten() 
			});
		}

		const { promptText, userSession, projectId, responseSummary, language } = parsed.data;
		
		const promptId = await saveUserPrompt(promptText, userSession, projectId, responseSummary, language);
		
		res.status(201).json({
			id: promptId,
			userSession,
			projectId,
			language,
			wasTranslated: language !== 'en',
			message: 'Prompt salvo com sucesso'
		});
	} catch (err) {
		next(err);
	}
});

// POST /embeddings/sap-docs -> Salvar documentação SAP com tradução
router.post('/sap-docs', async (req, res, next) => {
	try {
		const parsed = saveSAPDocSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ 
				error: 'Payload inválido', 
				details: parsed.error.flatten() 
			});
		}

		const { content, docTitle, docUrl, sapComponent, docSection, language } = parsed.data;
		
		const docId = await saveSAPDocumentation(content, docTitle, docUrl, sapComponent, docSection, language);
		
		res.status(201).json({
			id: docId,
			docTitle,
			sapComponent,
			language,
			wasTranslated: language !== 'en',
			message: 'Documentação SAP salva com sucesso'
		});
	} catch (err) {
		next(err);
	}
});

// GET /embeddings/stats -> Estatísticas dos embeddings com info de idioma
router.get('/stats', async (req, res, next) => {
	try {
		const { query } = require('../services/database');
		
		const stats = await query(`
			SELECT 
				content_type,
				original_language,
				was_translated,
				COUNT(*) as count,
				AVG(LENGTH(content)) as avg_content_length
			FROM embeddings_base 
			GROUP BY content_type, original_language, was_translated
			ORDER BY count DESC
		`);
		
		const total = await query('SELECT COUNT(*) as total FROM embeddings_base');
		
		res.json({
			total: parseInt(total.rows[0].total),
			byTypeAndLanguage: stats.rows.map(row => ({
				contentType: row.content_type,
				originalLanguage: row.original_language,
				wasTranslated: row.was_translated,
				count: parseInt(row.count),
				avgContentLength: Math.round(parseFloat(row.avg_content_length))
			}))
		});
	} catch (err) {
		next(err);
	}
});

// GET /embeddings/debug -> Debug das distâncias
router.get('/debug', async (req, res, next) => {
	try {
		const { query: searchQuery } = req.query;
		
		if (!searchQuery) {
			return res.status(400).json({ error: 'Query parameter "query" é obrigatório' });
		}

		console.log('🔍 DEBUG: Buscando por:', searchQuery);

		// Gerar embedding do texto de busca
		const { generateEmbedding, cleanTextForEmbedding } = require('../services/openai');
		const cleanSearch = cleanTextForEmbedding(searchQuery);
		const searchEmbedding = await generateEmbedding(cleanSearch);

		// 🆕 LOG DO EMBEDDING GERADO PARA COPIAR
		console.log('🎯 EMBEDDING GERADO PARA BUSCA:');
		console.log('Texto limpo:', cleanSearch);
		console.log('Embedding (JSON):', JSON.stringify(searchEmbedding));
		console.log('Embedding (Array):', searchEmbedding);
		console.log('Dimensões:', searchEmbedding.length);

		// Query para ver TODAS as distâncias
		const debugQuery = `
			SELECT 
				id,
				content,
				content_type,
				metadata,
				embedding <=> $1 as distance,
				1 - (embedding <=> $1) as similarity,
				created_at
			FROM embeddings_base 
			ORDER BY embedding <=> $1
			LIMIT 10
		`;

		const { query: dbQuery } = require('../services/database');
		const result = await dbQuery(debugQuery, [JSON.stringify(searchEmbedding)]);
		
		console.log('📊 DEBUG RESULTADOS:');
		result.rows.forEach((row, index) => {
			console.log(`${index + 1}. ID: ${row.id}`);
			console.log(`   Content: ${row.content.substring(0, 100)}...`);
			console.log(`   Distance: ${row.distance}`);
			console.log(`   Similarity: ${row.similarity}`);
			console.log(`   Type: ${row.content_type}`);
			console.log('   ---');
		});

		res.json({
			searchQuery,
			searchEmbedding, // 🆕 Incluir no response também
			totalResults: result.rows.length,
			results: result.rows.map(row => ({
				id: row.id,
				content: row.content,
				contentType: row.content_type,
				distance: parseFloat(row.distance),
				similarity: parseFloat(row.similarity),
				createdAt: row.created_at
			}))
		});
	} catch (err) {
		console.error('❌ Erro no debug:', err);
		next(err);
	}
});

module.exports = router;
