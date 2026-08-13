FROM node:20-alpine

# Install OS dependencies required for some native modules and Prisma
RUN apk add --no-cache python3 make g++ openssl

# Set working directory
WORKDIR /app

# Copy package and lock files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies and generate Prisma Client
RUN npm ci
RUN npx prisma generate

# Copy the rest of the application
COPY . .

# Expose port
EXPOSE 3000

# Start the application using tsx
CMD ["npm", "start"]
