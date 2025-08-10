const { query, transaction } = require('./database');
const { generateEmbedding, cleanTextForEmbedding } = require('./openai');

/**
 * Salvar embedding no banco de dados
 * @param {string} content - Conteúdo original
 * @param {string} contentType - Tipo: 'prompt', 'source_code', 'template', 'documentation'
 * @param {Object} metadata - Metadados adicionais
 * @returns {Promise<string>} ID do embedding criado
 */
async function saveEmbedding(content, contentType, metadata = {}) {
	try {
		console.log('💾 Salvando embedding:', { contentType, contentLength: content.length });

		// Limpar e gerar embedding
		const cleanContent = cleanTextForEmbedding(content);
		const embedding = await generateEmbedding(cleanContent);

		// Salvar no banco
		const result = await query(
			`INSERT INTO embeddings_base (content, embedding, content_type, metadata) 
			 VALUES ($1, $2, $3, $4) 
			 RETURNING id`,
			[cleanContent, JSON.stringify(embedding), contentType, JSON.stringify(metadata)]
		);

		const embeddingId = result.rows[0].id;
		console.log('✅ Embedding salvo:', embeddingId);
		
		return embeddingId;
	} catch (error) {
		console.error('❌ Erro ao salvar embedding:', error.message);
		throw error;
	}
}

/**
 * Buscar embeddings similares
 * @param {string} searchText - Texto para buscar
 * @param {string} contentType - Filtrar por tipo (opcional)
 * @param {number} limit - Limite de resultados
 * @param {number} threshold - Threshold de distância (quanto menor, mais similar)
 * @returns {Promise<Array>} Resultados similares
 */
async function searchSimilar(searchText, contentType = null, limit = 10, threshold = 1.5) {
	try {
		console.log('🔍 Buscando embeddings similares:', { searchText: searchText.substring(0, 50) + '...', contentType, limit, threshold });

		// Gerar embedding do texto de busca
		const cleanSearch = cleanTextForEmbedding(searchText);
		const searchEmbedding = await generateEmbedding(cleanSearch);

		// Query usando L2 distance (<->) como no seu exemplo
		let queryText = `
			SELECT 
				id,
				content,
				content_type,
				metadata,
				embedding <-> $1::vector as distance,
				created_at
			FROM embeddings_base 
			WHERE embedding <-> $1::vector <= $2
		`;
		
		let params = [JSON.stringify(searchEmbedding), threshold];
		
		if (contentType) {
			queryText += ` AND content_type = $3`;
			params.push(contentType);
		}
		
		queryText += ` ORDER BY embedding <-> $1::vector ASC LIMIT $${params.length + 1}`;
		params.push(limit);

		const result = await query(queryText, params);
		
		console.log('✅ Encontrados:', result.rows.length, 'resultados similares');
		
		return result.rows.map(row => ({
			id: row.id,
			content: row.content,
			contentType: row.content_type,
			metadata: row.metadata,
			distance: parseFloat(row.distance),
			similarity: Math.max(0, 1 - parseFloat(row.distance)), // Similaridade baseada na distância
			createdAt: row.created_at
		}));
	} catch (error) {
		console.error('❌ Erro na busca similar:', error.message);
		throw error;
	}
}

/**
 * Salvar prompt do usuário
 * @param {string} promptText - Texto do prompt
 * @param {string} userSession - ID da sessão do usuário
 * @param {string} projectId - ID do projeto (opcional)
 * @param {string} responseSummary - Resumo da resposta (opcional)
 * @returns {Promise<string>} ID do prompt salvo
 */
async function saveUserPrompt(promptText, userSession, projectId = null, responseSummary = null) {
	try {
		return await transaction(async (client) => {
			// Salvar embedding base
			const cleanContent = cleanTextForEmbedding(promptText);
			const embedding = await generateEmbedding(cleanContent);
			
			const embeddingResult = await client.query(
				`INSERT INTO embeddings_base (content, embedding, content_type, metadata) 
				 VALUES ($1, $2, 'prompt', $3) 
				 RETURNING id`,
				[cleanContent, JSON.stringify(embedding), JSON.stringify({ userSession, projectId })]
			);
			
			const embeddingId = embeddingResult.rows[0].id;
			
			// Salvar prompt específico
			const promptResult = await client.query(
				`INSERT INTO user_prompts (embedding_id, user_session, prompt_text, project_id, response_summary) 
				 VALUES ($1, $2, $3, $4, $5) 
				 RETURNING id`,
				[embeddingId, userSession, promptText, projectId, responseSummary]
			);
			
			console.log('✅ Prompt do usuário salvo:', promptResult.rows[0].id);
			return promptResult.rows[0].id;
		});
	} catch (error) {
		console.error('❌ Erro ao salvar prompt:', error.message);
		throw error;
	}
}

/**
 * Salvar documentação SAP
 * @param {string} content - Conteúdo da documentação
 * @param {string} docTitle - Título do documento
 * @param {string} docUrl - URL da documentação
 * @param {string} sapComponent - Componente SAP (ex: 'sap.m')
 * @param {string} docSection - Seção do documento (opcional)
 * @returns {Promise<string>} ID da documentação salva
 */
async function saveSAPDocumentation(content, docTitle, docUrl, sapComponent, docSection = null) {
	try {
		return await transaction(async (client) => {
			// Salvar embedding base
			const cleanContent = cleanTextForEmbedding(content);
			const embedding = await generateEmbedding(cleanContent);
			
			const metadata = {
				docTitle,
				docUrl,
				sapComponent,
				docSection
			};
			
			const embeddingResult = await client.query(
				`INSERT INTO embeddings_base (content, embedding, content_type, metadata) 
				 VALUES ($1, $2, 'documentation', $3) 
				 RETURNING id`,
				[cleanContent, JSON.stringify(embedding), JSON.stringify(metadata)]
			);
			
			const embeddingId = embeddingResult.rows[0].id;
			
			// Salvar documentação específica
			const docResult = await client.query(
				`INSERT INTO documentation_embeddings (embedding_id, doc_title, doc_section, doc_url, doc_type, sap_component) 
				 VALUES ($1, $2, $3, $4, 'sap_official', $5) 
				 RETURNING id`,
				[embeddingId, docTitle, docSection, docUrl, sapComponent]
			);
			
			console.log('✅ Documentação SAP salva:', docResult.rows[0].id);
			return docResult.rows[0].id;
		});
	} catch (error) {
		console.error('❌ Erro ao salvar documentação:', error.message);
		throw error;
	}
}

module.exports = {
	saveEmbedding,
	searchSimilar,
	saveUserPrompt,
	saveSAPDocumentation
};