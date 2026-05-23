# syntax=docker/dockerfile:1

FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS build
WORKDIR /opt/app-root/src

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS runtime
WORKDIR /opt/app-root/src

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /opt/app-root/src/dist ./dist
COPY --from=build /opt/app-root/src/server.js ./server.js

EXPOSE 8080
CMD ["npm", "start"]
