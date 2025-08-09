FROM node:22-alpine
WORKDIR /home/node/app

# deps fixas na imagem
COPY package*.json ./
RUN npm ci

# resto do projeto (ui5.yaml, fiori tools, etc.)
COPY . .

# melhora o file-watching dentro de container
ENV CHOKIDAR_USEPOLLING=1

EXPOSE 8081
CMD ["npm","start"]
