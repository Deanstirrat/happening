FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Skip playwright install — only needed for scrape job (see Dockerfile.scrape)
RUN npm ci --ignore-scripts && npx prisma generate

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy; npm start -- -p ${PORT:-3000}"]
