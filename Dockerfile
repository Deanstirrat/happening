FROM node:20-bookworm

WORKDIR /app

# Copy package files and prisma schema before npm ci so postinstall
# (prisma generate + playwright install --with-deps chromium) can run.
# Running as root in this image lets playwright install system deps via apt-get.
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start -- -p ${PORT:-3000}"]
