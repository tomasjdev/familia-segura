# Deploy a Neon (PostgreSQL) + API

## 1) Variables de entorno
- Copia `.env.example` a `.env` y completa valores reales.
- Asegúrate que `DATABASE_URL` de Neon tenga `sslmode=require` (y `pgbouncer=true` si usas pooling).

## 2) Cambios en Prisma
- En `prisma/schema.prisma`, el `datasource` debe ser:
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
