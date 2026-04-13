FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_PATH=/data/bonna.db
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
