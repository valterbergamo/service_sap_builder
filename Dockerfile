FROM node:18-alpine

# Instalar Docker CLI e Docker Compose
RUN apk add --no-cache docker-cli docker-compose

WORKDIR /home/node/app

# Copiar package.json primeiro
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código fonte
COPY . .

# Criar diretórios e ajustar permissões
RUN mkdir -p /home/node/app/projects && \
    chmod -R 777 /home/node/app/projects

# Expor porta
EXPOSE 3000

CMD ["npm", "start"]