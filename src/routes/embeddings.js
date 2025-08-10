const { Router } = require('express');
const { z } = require('zod');
const { 
	saveEmbedding, 
	searchSimilar, 
	saveUserPrompt, 
	saveSAPDocumentation 
} = require('../services/embeddings');

const router = Router();

// Schemas de validação
const generateEmbeddingSchema = z.object({
	content: z.string().min(1).max(8000),
	contentType: z.enum(['prompt', 'source_code', 'template', 'documentation']),
	metadata: z.record(z.any()).optional().default({})
});

const searchSchema = z.object({
	query: z.string().min(1).max(1000),
	contentType: z.enum(['prompt', 'source_code', 'template', 'documentation']).optional(),
	limit: z.string().transform(val => parseInt(val)).pipe(z.number().int().min(1).max(50)).optional().default(10),
	threshold: z.string().transform(val => parseFloat(val)).pipe(z.number().min(0).max(3)).optional().default(1.5)
});

const savePromptSchema = z.object({
	promptText: z.string().min(1).max(4000),
	userSession: z.string().min(1).max(255),
	projectId: z.string().max(64).optional(),
	responseSummary: z.string().max(2000).optional()
});

const saveSAPDocSchema = z.object({
	content: z.string().min(1).max(8000),
	docTitle: z.string().min(1).max(255),
	docUrl: z.string().url().optional(),
	sapComponent: z.string().min(1).max(100),
	docSection: z.string().max(255).optional()
});

// POST /embeddings/generate -> Gerar e salvar embedding
router.post('/generate', async (req, res, next) => {
	try {
		const parsed = generateEmbeddingSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ 
				error: 'Payload inválido', 
				details: parsed.error.flatten() 
			});
		}

		const { content, contentType, metadata } = parsed.data;
		
		const embeddingId = await saveEmbedding(content, contentType, metadata);
		
		res.status(201).json({
			id: embeddingId,
			contentType,
			contentLength: content.length,
			message: 'Embedding gerado e salvo com sucesso'
		});
	} catch (err) {
		next(err);
	}
});

// GET /embeddings/search -> Busca semântica
router.get('/search', async (req, res, next) => {
	try {
		// Converter query params manualmente
		const searchParams = {
			query: req.query.query,
			contentType: req.query.contentType,
			limit: req.query.limit ? parseInt(req.query.limit) : 10,
			threshold: req.query.threshold ? parseFloat(req.query.threshold) : 1.5
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

// POST /embeddings/prompts -> Salvar prompt do usuário
router.post('/prompts', async (req, res, next) => {
	try {
		const parsed = savePromptSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ 
				error: 'Payload inválido', 
				details: parsed.error.flatten() 
			});
		}

		const { promptText, userSession, projectId, responseSummary } = parsed.data;
		
		const promptId = await saveUserPrompt(promptText, userSession, projectId, responseSummary);
		
		res.status(201).json({
			id: promptId,
			userSession,
			projectId,
			message: 'Prompt salvo com sucesso'
		});
	} catch (err) {
		next(err);
	}
});

// POST /embeddings/sap-docs -> Salvar documentação SAP
router.post('/sap-docs', async (req, res, next) => {
	try {
		const parsed = saveSAPDocSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ 
				error: 'Payload inválido', 
				details: parsed.error.flatten() 
			});
		}

		const { content, docTitle, docUrl, sapComponent, docSection } = parsed.data;
		
		const docId = await saveSAPDocumentation(content, docTitle, docUrl, sapComponent, docSection);
		
		res.status(201).json({
			id: docId,
			docTitle,
			sapComponent,
			message: 'Documentação SAP salva com sucesso'
		});
	} catch (err) {
		next(err);
	}
});

// GET /embeddings/stats -> Estatísticas dos embeddings
router.get('/stats', async (req, res, next) => {
	try {
		const { query } = require('../services/database');
		
		const stats = await query(`
			SELECT 
				content_type,
				COUNT(*) as count,
				AVG(LENGTH(content)) as avg_content_length
			FROM embeddings_base 
			GROUP BY content_type
			ORDER BY count DESC
		`);
		
		const total = await query('SELECT COUNT(*) as total FROM embeddings_base');
		
		res.json({
			total: parseInt(total.rows[0].total),
			byType: stats.rows.map(row => ({
				contentType: row.content_type,
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