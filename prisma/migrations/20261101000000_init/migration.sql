-- pgvector powers similarity search over advisory chunks (Prisma cannot declare extensions here).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "farmers" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "language" TEXT NOT NULL DEFAULT 'hi',
    "location_name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "state" TEXT,
    "district" TEXT,
    "soil_card" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farmers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farmer_crops" (
    "id" TEXT NOT NULL,
    "farmer_id" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "sowing_date" DATE NOT NULL,
    "area_acres" DOUBLE PRECISION,

    CONSTRAINT "farmer_crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "farmer_id" TEXT,
    "language" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "guardrail" JSONB,
    "turn_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "turn_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "args" JSONB,
    "result_summary" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "crops" TEXT[],
    "content_hash" TEXT NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "page_count" INTEGER,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advisory_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "section" TEXT,
    "page_from" INTEGER,
    "page_to" INTEGER,
    "crops" TEXT[],
    "content" TEXT NOT NULL,
    "token_estimate" INTEGER NOT NULL,
    "embedding" vector(768) NOT NULL,

    CONSTRAINT "advisory_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_cache" (
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "mandi_prices" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "arrival_date" DATE NOT NULL,
    "min_price" DOUBLE PRECISION NOT NULL,
    "max_price" DOUBLE PRECISION NOT NULL,
    "modal_price" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandi_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "farmer_id" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "evidence" JSONB NOT NULL,
    "citations" JSONB NOT NULL,
    "turn_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farmer_crops_farmer_id_crop_key" ON "farmer_crops"("farmer_id", "crop");

-- CreateIndex
CREATE INDEX "conversations_farmer_id_idx" ON "conversations"("farmer_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_steps_turn_id_idx" ON "agent_steps"("turn_id");

-- CreateIndex
CREATE INDEX "agent_steps_conversation_id_idx" ON "agent_steps"("conversation_id");

-- CreateIndex
CREATE INDEX "advisory_chunks_document_id_idx" ON "advisory_chunks"("document_id");

-- CreateIndex
CREATE INDEX "api_cache_expires_at_idx" ON "api_cache"("expires_at");

-- CreateIndex
CREATE INDEX "mandi_prices_commodity_state_district_arrival_date_idx" ON "mandi_prices"("commodity", "state", "district", "arrival_date");

-- CreateIndex
CREATE UNIQUE INDEX "mandi_prices_state_district_market_commodity_variety_grade__key" ON "mandi_prices"("state", "district", "market", "commodity", "variety", "grade", "arrival_date");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_dedupe_key_key" ON "alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "alerts_farmer_id_created_at_idx" ON "alerts"("farmer_id", "created_at");

-- AddForeignKey
ALTER TABLE "farmer_crops" ADD CONSTRAINT "farmer_crops_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "farmers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "farmers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_chunks" ADD CONSTRAINT "advisory_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "advisory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "farmers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- HNSW index for cosine-distance nearest-neighbour search over advisory chunks.
-- Declared here because Prisma has no HNSW index type; do not let `migrate dev` drop it.
CREATE INDEX "advisory_chunks_embedding_hnsw_idx" ON "advisory_chunks" USING hnsw ("embedding" vector_cosine_ops);
