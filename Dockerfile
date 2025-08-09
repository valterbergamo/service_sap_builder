FROM node:18-alpine

# Criar usuário e diretório
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app

# Copiar package.json primeiro (para cache de layers)
COPY package*.json ./

# Mudar para usuário node antes de instalar
USER node

# Instalar dependências
RUN npm ci --only=production

# Copiar código fonte
COPY --chown=node:node . .

# Expor a porta que a aplicação usa internamente
EXPOSE 3000

# Comando para iniciar
CMD ["npm", "start"]