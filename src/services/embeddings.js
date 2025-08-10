const { query, transaction } = require('./database');
const { generateEmbedding, cleanTextForEmbedding, translateToEnglishPreservingTechnicalTerms, splitTextIntoChunks } = require('./openai');

/**
 * Salvar embedding no banco de dados com suporte a tradução
 * @param {string} content - Conteúdo original
 * @param {string} contentType - Tipo: 'prompt', 'source_code', 'template', 'documentation'
 * @param {Object} metadata - Metadados adicionais
 * @param {string} language - Idioma do conteúdo ('en', 'pt', 'es', etc.)
 * @returns {Promise<string>} ID do embedding criado
 */
async function saveEmbedding(content, contentType, metadata = {}, language = 'en') {
	try {
		console.log('💾 Salvando embedding:', { contentType, contentLength: content.length, language });

		let contentToSave = content;
		let wasTranslated = false;
		let translationInfo = null;

		// Traduzir apenas se não for inglês
		if (language && language !== 'en') {
			console.log('🌐 Traduzindo conteúdo de', language, 'para inglês...');
			translationInfo = await translateToEnglishPreservingTechnicalTerms(content, language);
			contentToSave = translationInfo.translatedText;
			wasTranslated = translationInfo.wasTranslated;
		}

		// Limpar e gerar embedding do conteúdo (sempre em inglês)
		const cleanContent = cleanTextForEmbedding(contentToSave);
		const embedding = await generateEmbedding(cleanContent);

		// Preparar metadados com informações de tradução
		const enhancedMetadata = {
			...metadata,
			originalLanguage: language,
			wasTranslated,
			...(translationInfo && {
				detectedLanguage: translationInfo.detectedLanguage,
				technicalTerms: translationInfo.technicalTerms
			})
		};

		// Salvar no banco
		const result = await query(
			`INSERT INTO embeddings_base (content, embedding, content_type, metadata, original_language, was_translated) 
			 VALUES ($1, $2, $3, $4, $5, $6) 
			 RETURNING id`,
			[cleanContent, JSON.stringify(embedding), contentType, JSON.stringify(enhancedMetadata), language, wasTranslated]
		);

		const embeddingId = result.rows[0].id;
		console.log('✅ Embedding salvo:', embeddingId, wasTranslated ? '(traduzido)' : '(original)');
		
		return embeddingId;
	} catch (error) {
		console.error('❌ Erro ao salvar embedding:', error.message);
		throw error;
	}
}

/**
 * Buscar embeddings similares com tradução automática da query
 * @param {string} searchText - Texto para buscar
 * @param {string} contentType - Filtrar por tipo (opcional)
 * @param {number} limit - Limite de resultados
 * @param {number} threshold - Threshold de distância
 * @param {string} language - Idioma da query ('auto' para detectar)
 * @returns {Promise<Object>} Resultados similares com informações de tradução
 */
async function searchSimilarWithTranslation(searchText, contentType = null, limit = 10, threshold = 1.5, language = 'auto') {
	try {
		console.log('🔍 Buscando com tradução automática:', { 
			searchText: searchText.substring(0, 50) + '...', 
			contentType, 
			limit, 
			threshold,
			language 
		});

		let searchTextToUse = searchText;
		let translationInfo = null;

		// Traduzir query se necessário
		if (language !== 'en') {
			console.log('🌐 Traduzindo query para inglês...');
			translationInfo = await translateToEnglishPreservingTechnicalTerms(searchText, language);
			
			// Só usar tradução se realmente foi traduzido
			if (translationInfo.wasTranslated) {
				searchTextToUse = translationInfo.translatedText;
			}
		}

		// Buscar usando texto em inglês
		const results = await searchSimilar(searchTextToUse, contentType, limit, threshold);

		return {
			query: {
				original: searchText,
				translated: searchTextToUse,
				wasTranslated: translationInfo?.wasTranslated || false,
				detectedLanguage: translationInfo?.detectedLanguage || language
			},
			results,
			resultCount: results.length,
			searchParams: { contentType, limit, threshold }
		};
	} catch (error) {
		console.error('❌ Erro na busca com tradução:', error.message);
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
 * Salvar prompt do usuário com suporte a tradução
 * @param {string} promptText - Texto do prompt
 * @param {string} userSession - ID da sessão do usuário
 * @param {string} projectId - ID do projeto (opcional)
 * @param {string} responseSummary - Resumo da resposta (opcional)
 * @param {string} language - Idioma do prompt
 * @returns {Promise<string>} ID do prompt salvo
 */
async function saveUserPrompt(promptText, userSession, projectId = null, responseSummary = null, language = 'en') {
	try {
		return await transaction(async (client) => {
			let contentToSave = promptText;
			let wasTranslated = false;
			let translationInfo = null;

			// Traduzir se necessário
			if (language && language !== 'en') {
				translationInfo = await translateToEnglishPreservingTechnicalTerms(promptText, language);
				contentToSave = translationInfo.translatedText;
				wasTranslated = translationInfo.wasTranslated;
			}

			// Salvar embedding base
			const cleanContent = cleanTextForEmbedding(contentToSave);
			const embedding = await generateEmbedding(cleanContent);
			
			const metadata = {
				userSession, 
				projectId,
				originalLanguage: language,
				wasTranslated,
				...(translationInfo && {
					detectedLanguage: translationInfo.detectedLanguage,
					technicalTerms: translationInfo.technicalTerms
				})
			};
			
			const embeddingResult = await client.query(
				`INSERT INTO embeddings_base (content, embedding, content_type, metadata, original_language, was_translated) 
				 VALUES ($1, $2, 'prompt', $3, $4, $5) 
				 RETURNING id`,
				[cleanContent, JSON.stringify(embedding), JSON.stringify(metadata), language, wasTranslated]
			);
			
			const embeddingId = embeddingResult.rows[0].id;
			
			// Salvar prompt específico
			const promptResult = await client.query(
				`INSERT INTO user_prompts (embedding_id, user_session, prompt_text, project_id, response_summary) 
				 VALUES ($1, $2, $3, $4, $5) 
				 RETURNING id`,
				[embeddingId, userSession, promptText, projectId, responseSummary]
			);
			
			console.log('✅ Prompt do usuário salvo:', promptResult.rows[0].id, wasTranslated ? '(traduzido)' : '(original)');
			return promptResult.rows[0].id;
		});
	} catch (error) {
		console.error('❌ Erro ao salvar prompt:', error.message);
		throw error;
	}
}

/**
 * Salvar documentação SAP com suporte a tradução
 * @param {string} content - Conteúdo da documentação
 * @param {string} docTitle - Título do documento
 * @param {string} docUrl - URL da documentação
 * @param {string} sapComponent - Componente SAP (ex: 'sap.m')
 * @param {string} docSection - Seção do documento (opcional)
 * @param {string} language - Idioma da documentação
 * @returns {Promise<string>} ID da documentação salva
 */
async function saveSAPDocumentation(content, docTitle, docUrl, sapComponent, docSection = null, language = 'en') {
	try {
		return await transaction(async (client) => {
			let contentToSave = content;
			let wasTranslated = false;
			let translationInfo = null;

			// Traduzir se necessário
			if (language && language !== 'en') {
				translationInfo = await translateToEnglishPreservingTechnicalTerms(content, language);
				contentToSave = translationInfo.translatedText;
				wasTranslated = translationInfo.wasTranslated;
			}

			// Salvar embedding base
			const cleanContent = cleanTextForEmbedding(contentToSave);
			const embedding = await generateEmbedding(cleanContent);
			
			const metadata = {
				docTitle,
				docUrl,
				sapComponent,
				docSection,
				originalLanguage: language,
				wasTranslated,
				...(translationInfo && {
					detectedLanguage: translationInfo.detectedLanguage,
					technicalTerms: translationInfo.technicalTerms
				})
			};
			
			const embeddingResult = await client.query(
				`INSERT INTO embeddings_base (content, embedding, content_type, metadata, original_language, was_translated) 
				 VALUES ($1, $2, 'documentation', $3, $4, $5) 
				 RETURNING id`,
				[cleanContent, JSON.stringify(embedding), JSON.stringify(metadata), language, wasTranslated]
			);
			
			const embeddingId = embeddingResult.rows[0].id;
			
			// Salvar documentação específica
			const docResult = await client.query(
				`INSERT INTO documentation_embeddings (embedding_id, doc_title, doc_section, doc_url, doc_type, sap_component) 
				 VALUES ($1, $2, $3, $4, 'sap_official', $5) 
				 RETURNING id`,
				[embeddingId, docTitle, docSection, docUrl, sapComponent]
			);
			
			console.log('✅ Documentação SAP salva:', docResult.rows[0].id, wasTranslated ? '(traduzida)' : '(original)');
			return docResult.rows[0].id;
		});
	} catch (error) {
		console.error('❌ Erro ao salvar documentação:', error.message);
		throw error;
	}
}

/**
 * Processar documento completo com chunking automático
 * @param {string} documentContent - Conteúdo completo do documento
 * @param {string} docTitle - Título do documento
 * @param {string} docType - Tipo do documento (pdf, txt, docx)
 * @param {string} sapComponent - Componente SAP relacionado
 * @param {string} language - Idioma do documento
 * @param {Object} additionalMetadata - Metadados adicionais
 * @returns {Promise<{documentId: string, chunksCreated: number, totalWords: number}>}
 */
async function processDocumentWithChunking(documentContent, docTitle, docType, sapComponent, language = 'en', additionalMetadata = {}) {
	try {
		console.log('📄 Processando documento com chunking:', {
			title: docTitle,
			contentLength: documentContent.length,
			language,
			docType
		});

		return await transaction(async (client) => {
			let translationInfo = null;
			let wasTranslated = false;

			// Traduzir documento completo se necessário (para metadados)
			if (language && language !== 'en') {
				console.log('🌐 Traduzindo documento para análise...');
				translationInfo = await translateToEnglishPreservingTechnicalTerms(
					documentContent.substring(0, 1000), // Apenas uma amostra para detectar idioma
					language
				);
				wasTranslated = translationInfo.wasTranslated;
			}

			// Criar registro principal do documento
			const docMetadata = {
				originalLanguage: language,
				wasTranslated,
				fileType: docType,
				fileSize: documentContent.length,
				sapComponent,
				...additionalMetadata,
				...(translationInfo && {
					detectedLanguage: translationInfo.detectedLanguage,
					technicalTerms: translationInfo.technicalTerms
				})
			};

			const docResult = await client.query(
				`INSERT INTO documentation_embeddings (
					doc_title, doc_type, sap_component, 
					original_language, was_translated, 
					file_size, file_type, total_chunks
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
				RETURNING id`,
				[docTitle, 'uploaded', sapComponent, language, wasTranslated, documentContent.length, docType, 0]
			);

			const documentId = docResult.rows[0].id;

			// Dividir em chunks
			const chunks = splitTextIntoChunks(documentContent);
			console.log('✂️ Documento dividido em', chunks.length, 'chunks');

			// Processar cada chunk
			let processedChunks = 0;
			const chunkPromises = chunks.map(async (chunk, index) => {
				try {
					let chunkToSave = chunk;
					let chunkWasTranslated = false;
					let chunkTranslationInfo = null;

					// Traduzir chunk se necessário
					if (language && language !== 'en') {
						chunkTranslationInfo = await translateToEnglishPreservingTechnicalTerms(chunk, language);
						chunkToSave = chunkTranslationInfo.translatedText;
						chunkWasTranslated = chunkTranslationInfo.wasTranslated;
					}

					// Gerar embedding do chunk
					const cleanChunk = cleanTextForEmbedding(chunkToSave);
					const embedding = await generateEmbedding(cleanChunk);

					// Dentro da função processDocumentWithChunking, na parte dos metadados do chunk:

					// Metadados do chunk
					const chunkMetadata = {
						documentId,
						documentTitle: docTitle,
						chunkIndex: index,
						totalChunks: chunks.length,
						originalLanguage: language,
						wasTranslated: chunkWasTranslated,
						// Incluir metadados de busca personalizados
						...(additionalMetadata.searchMetadata && { searchMetadata: additionalMetadata.searchMetadata }),
						...(chunkTranslationInfo && {
							detectedLanguage: chunkTranslationInfo.detectedLanguage,
							technicalTerms: chunkTranslationInfo.technicalTerms
						})
					};

					// Salvar chunk no banco
					await client.query(
						`INSERT INTO embeddings_base (
							content, embedding, content_type, metadata, 
							original_language, was_translated, 
							document_id, chunk_index, chunk_total
						) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
						[
							cleanChunk, JSON.stringify(embedding), 'documentation', 
							JSON.stringify(chunkMetadata), language, chunkWasTranslated,
							documentId, index, chunks.length
						]
					);

					processedChunks++;
					console.log(`✅ Chunk ${index + 1}/${chunks.length} processado`);
				} catch (error) {
					console.error(`❌ Erro no chunk ${index}:`, error.message);
					throw error;
				}
			});

			// Aguardar todos os chunks serem processados
			await Promise.all(chunkPromises);

			// Atualizar total de chunks no documento
			await client.query(
				'UPDATE documentation_embeddings SET total_chunks = $1 WHERE id = $2',
				[chunks.length, documentId]
			);

			console.log('🎉 Documento processado com sucesso:', {
				documentId,
				chunksCreated: processedChunks,
				totalWords: documentContent.split(/\s+/).length
			});

			return {
				documentId,
				chunksCreated: processedChunks,
				totalWords: documentContent.split(/\s+/).length,
				wasTranslated,
				language: translationInfo?.detectedLanguage || language
			};
		});
	} catch (error) {
		console.error('❌ Erro ao processar documento:', error.message);
		throw error;
	}
}

/**
 * Buscar chunks de um documento específico
 * @param {string} documentId - ID do documento
 * @returns {Promise<Array>} Lista de chunks do documento
 */
async function getDocumentChunks(documentId) {
	try {
		const result = await query(
			`SELECT 
				id, content, chunk_index, chunk_total, 
				metadata, created_at, was_translated
			FROM embeddings_base 
			WHERE document_id = $1 
			ORDER BY chunk_index ASC`,
			[documentId]
		);

		return result.rows.map(row => ({
			id: row.id,
			content: row.content,
			chunkIndex: row.chunk_index,
			chunkTotal: row.chunk_total,
			metadata: row.metadata,
			wasTranslated: row.was_translated,
			createdAt: row.created_at
		}));
	} catch (error) {
		console.error('❌ Erro ao buscar chunks do documento:', error.message);
		throw error;
	}
}


/**
 * Busca inteligente com thresholds progressivos (economiza API calls)
 * @param {string} searchText - Texto para buscar
 * @param {string} contentType - Filtrar por tipo (opcional)
 * @param {number} limit - Limite de resultados
 * @param {string} language - Idioma da query
 * @returns {Promise<Object>} Resultados com informações de threshold usado
 */
async function searchWithProgressiveThreshold(searchText, contentType = null, limit = 10, language = 'auto', maxDistance = 0.8) {
	try {
		console.log('🎯 Busca inteligente com thresholds progressivos:', { 
			searchText: searchText.substring(0, 50) + '...', 
			contentType, 
			limit, 
			language,
			maxDistance // ← NOVO LOG
		});

		// 1. GERAR EMBEDDING UMA VEZ SÓ (economiza API calls)
		let textToSearch = searchText;
		let translationInfo = null;
		let wasTranslated = false;

		// Traduzir se necessário
		if (language && language !== 'en' && language !== 'auto') {
			translationInfo = await translateToEnglishPreservingTechnicalTerms(searchText, language);
			textToSearch = translationInfo.translatedText;
			wasTranslated = translationInfo.wasTranslated;
		}

		const cleanSearch = cleanTextForEmbedding(textToSearch);
		const searchEmbedding = await generateEmbedding(cleanSearch);

		console.log('✅ Embedding gerado uma vez, testando thresholds...');

		// 2. THRESHOLDS PROGRESSIVOS
		const thresholds = [1.0, 1.5, 2.0, 2.5];
		let results = [];
		let usedThreshold = null;

		for (const threshold of thresholds) {
			console.log(`🔍 Testando threshold: ${threshold}, maxDistance: ${maxDistance}`);

			// Query usando o mesmo embedding + filtro de distância máxima
			let queryText = `
				SELECT 
					id, content, content_type, metadata, created_at,
					embedding <=> $1 as distance,
					1 - (embedding <=> $1) as similarity
				FROM embeddings_base 
				WHERE embedding <=> $1 <= $2
				AND embedding <=> $1 <= $3
			`;
			
			const queryParams = [JSON.stringify(searchEmbedding), threshold, maxDistance];

			if (contentType) {
				queryText += ` AND content_type = $4`;
				queryParams.push(contentType);
			}

			queryText += ` ORDER BY embedding <=> $1 LIMIT $${queryParams.length + 1}`;
			queryParams.push(limit);

			const result = await query(queryText, queryParams);

			if (result.rows.length > 0) {
				console.log(`✅ Encontrou ${result.rows.length} resultados com threshold ${threshold} e maxDistance ${maxDistance}`);
				results = result.rows;
				usedThreshold = threshold;
				break;
			} else {
				console.log(`❌ Nenhum resultado com threshold ${threshold} e maxDistance ${maxDistance}, tentando próximo...`);
			}
		}

		// 3. RETORNAR RESULTADOS COM INFO DO THRESHOLD E DISTÂNCIA USADOS
		return {
			query: searchText,
			originalQuery: searchText,
			translatedQuery: wasTranslated ? textToSearch : null,
			wasTranslated,
			usedThreshold,
			maxDistance, // ← NOVO CAMPO
			testedThresholds: thresholds,
			resultsCount: results.length,
			results: results.map(row => ({
				id: row.id,
				content: row.content,
				contentType: row.content_type,
				metadata: row.metadata,
				distance: parseFloat(row.distance),
				similarity: Math.max(0, 1 - parseFloat(row.distance)),
				createdAt: row.created_at
			})),
			...(translationInfo && {
				detectedLanguage: translationInfo.detectedLanguage,
				technicalTerms: translationInfo.technicalTerms
			})
		};

	} catch (error) {
		console.error('❌ Erro na busca progressiva:', error.message);
		throw error;
	}
}

module.exports = {
	saveEmbedding,
	searchSimilar,
	searchSimilarWithTranslation,
	searchWithProgressiveThreshold, // ← ADICIONAR ESTA LINHA
	saveUserPrompt,
	saveSAPDocumentation,
	processDocumentWithChunking,
	getDocumentChunks
};