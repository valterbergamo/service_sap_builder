const OpenAI = require('openai');

// Inicializar cliente OpenAI
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Detectar idioma e traduzir para inglês preservando termos técnicos SAP
 * @param {string} text - Texto para traduzir
 * @param {string} sourceLanguage - Idioma de origem (opcional, 'auto' para detectar)
 * @returns {Promise<{originalText: string, translatedText: string, wasTranslated: boolean, detectedLanguage: string, technicalTerms: string[]}>}
 */
async function translateToEnglishPreservingTechnicalTerms(text, sourceLanguage = 'auto') {
	try {
		console.log('🌐 Iniciando tradução inteligente:', { 
			textLength: text.length, 
			sourceLanguage 
		});
		
		const response = await openai.chat.completions.create({
			model: 'gpt-3.5-turbo',
			messages: [
				{
					role: 'system',
					content: `You are a specialized translator for SAP technical documentation. Your task is to:

1. DETECT the language of the input text
2. If it's already English, return it unchanged
3. If it's another language, translate to English while PRESERVING:
   - SAP technical terms (MATNR, WERKS, BAPI, IDOC, etc.)
   - Programming keywords and field names
   - Database table names and field names
   - Function module names
   - Transaction codes (T-codes)
   - Any UPPERCASE technical identifiers

4. Return a JSON response with this exact structure:
{
  "detectedLanguage": "language_code",
  "translatedText": "translated_content",
  "wasTranslated": boolean,
  "technicalTerms": ["array", "of", "preserved", "terms"]
}

Examples of terms to NEVER translate:
- MATNR, WERKS, LGORT, BUKRS
- BAPI_MATERIAL_GET, BAPI_CUSTOMER_CREATE
- MARA, MARC, MARD (table names)
- SE80, SM30, SPRO (transaction codes)
- ABAP, SAPUI5, OData`
				},
				{
					role: 'user',
					content: text
				}
			],
			temperature: 0.1,
			max_tokens: 2000
		});

		const result = JSON.parse(response.choices[0].message.content);
		
		console.log('✅ Tradução concluída:', {
			detectedLanguage: result.detectedLanguage,
			wasTranslated: result.wasTranslated,
			technicalTermsCount: result.technicalTerms?.length || 0
		});

		return {
			originalText: text,
			translatedText: result.translatedText,
			wasTranslated: result.wasTranslated,
			detectedLanguage: result.detectedLanguage,
			technicalTerms: result.technicalTerms || []
		};
	} catch (error) {
		console.error('❌ Erro na tradução:', error.message);
		// Em caso de erro, retorna o texto original
		return {
			originalText: text,
			translatedText: text,
			wasTranslated: false,
			detectedLanguage: 'unknown',
			technicalTerms: []
		};
	}
}

/**
 * Gerar embedding de um texto usando OpenAI
 * @param {string} text - Texto para gerar embedding
 * @param {string} model - Modelo a usar (padrão: text-embedding-3-small)
 * @returns {Promise<number[]>} Array com o embedding
 */
async function generateEmbedding(text, model = 'text-embedding-3-small') {
	try {
		console.log('🔄 Gerando embedding para texto:', text.substring(0, 100) + '...');
		
		const response = await openai.embeddings.create({
			model: model,
			input: text,
			encoding_format: 'float',
		});

		const embedding = response.data[0].embedding;
		console.log('✅ Embedding gerado com sucesso:', {
			dimensions: embedding.length,
			model: model,
			usage: response.usage
		});

		return embedding;
	} catch (error) {
		console.error('❌ Erro ao gerar embedding:', error.message);
		throw new Error(`Falha ao gerar embedding: ${error.message}`);
	}
}

/**
 * Gerar embeddings em lote
 * @param {string[]} texts - Array de textos
 * @param {string} model - Modelo a usar
 * @returns {Promise<number[][]>} Array de embeddings
 */
async function generateEmbeddings(texts, model = 'text-embedding-3-small') {
	try {
		console.log('🔄 Gerando embeddings em lote:', texts.length, 'textos');
		
		const response = await openai.embeddings.create({
			model: model,
			input: texts,
			encoding_format: 'float',
		});

		const embeddings = response.data.map(item => item.embedding);
		console.log('✅ Embeddings gerados com sucesso:', {
			count: embeddings.length,
			dimensions: embeddings[0]?.length,
			model: model,
			usage: response.usage
		});

		return embeddings;
	} catch (error) {
		console.error('❌ Erro ao gerar embeddings em lote:', error.message);
		throw new Error(`Falha ao gerar embeddings: ${error.message}`);
	}
}

/**
 * Limpar e preparar texto para embedding
 * @param {string} text - Texto bruto
 * @returns {string} Texto limpo
 */
function cleanTextForEmbedding(text) {
	return text
		.replace(/\s+/g, ' ') // Múltiplos espaços -> um espaço
		.replace(/\n+/g, '\n') // Múltiplas quebras -> uma quebra
		.trim() // Remove espaços das bordas
		.substring(0, 8000); // Limita tamanho (OpenAI tem limite)
}

/**
 * Dividir texto em chunks baseado em palavras (configurável via .env)
 * @param {string} text - Texto completo
 * @param {number} maxWords - Máximo de palavras por chunk (opcional)
 * @param {number} overlap - Sobreposição em palavras (opcional)
 * @returns {string[]} Array de chunks
 */
function splitTextIntoChunks(text, maxWords = null, overlap = null) {
	// Usar configurações do .env ou valores padrão
	const maxWordsToUse = maxWords || parseInt(process.env.CHUNK_MAX_WORDS) || 50;
	const overlapToUse = overlap || parseInt(process.env.CHUNK_OVERLAP_WORDS) || 25;
	
	console.log('✂️ Dividindo texto em chunks:', { 
		textLength: text.length, 
		maxWords: maxWordsToUse, 
		overlap: overlapToUse 
	});

	const words = text.split(/\s+/);
	const chunks = [];

	for (let i = 0; i < words.length; i += (maxWordsToUse - overlapToUse)) {
		const chunk = words.slice(i, i + maxWordsToUse).join(' ');
		if (chunk.trim()) {
			chunks.push(chunk.trim());
		}
	}

	console.log('✅ Chunks criados:', chunks.length);
	return chunks;
}

module.exports = {
	generateEmbedding,
	generateEmbeddings,
	cleanTextForEmbedding,
	splitTextIntoChunks,
	translateToEnglishPreservingTechnicalTerms
};