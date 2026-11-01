/**
 * Raw SQL for the pgvector column, which Prisma models as `Unsupported("vector(768)")`.
 * Everything else in the app uses the typed Prisma client.
 */
import { randomUUID } from "node:crypto";
import { getDb, Prisma } from "./client";

/** pgvector's text input format: `[0.1,0.2,...]`. */
export function toVectorLiteral(values: readonly number[]): string {
  // NaN/Infinity would silently poison every similarity score computed against this row.
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) {
    throw new Error("Embedding must be a non-empty array of finite numbers");
  }
  return `[${values.join(",")}]`;
}

export interface AdvisoryDocumentRecord {
  id: string;
  title: string;
  publisher: string;
  url: string;
  region: string;
  language: string;
  crops: string[];
  contentHash: string;
  embeddingModel: string;
  pageCount: number | null;
  fetchedAt: Date;
}

export interface ChunkRecord {
  chunkIndex: number;
  section: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  crops: string[];
  content: string;
  tokenEstimate: number;
  embedding: number[];
}

const INSERT_BATCH = 50;

/**
 * Atomically replaces a document and all its chunks, so retrieval never sees a half-ingested
 * document (old and new chunks mixed).
 */
export async function replaceDocument(
  doc: AdvisoryDocumentRecord,
  chunks: ChunkRecord[],
): Promise<void> {
  await getDb().$transaction(
    async (tx) => {
      const { id, ...fields } = doc;
      await tx.advisoryDocument.upsert({ where: { id }, create: doc, update: fields });
      await tx.$executeRaw`DELETE FROM advisory_chunks WHERE document_id = ${id}`;
      for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
        const rows = chunks.slice(i, i + INSERT_BATCH).map(
          (c) =>
            Prisma.sql`(${randomUUID()}, ${id}, ${c.chunkIndex}, ${c.section}, ${c.pageFrom}, ${c.pageTo},
              ${c.crops}::text[], ${c.content}, ${c.tokenEstimate}, ${toVectorLiteral(c.embedding)}::vector)`,
        );
        await tx.$executeRaw`
          INSERT INTO advisory_chunks
            (id, document_id, chunk_index, section, page_from, page_to, crops, content, token_estimate, embedding)
          VALUES ${Prisma.join(rows)}`;
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

export interface ChunkMatch {
  id: string;
  documentId: string;
  title: string;
  publisher: string;
  url: string;
  region: string;
  fetchedAt: Date;
  section: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  crops: string[];
  content: string;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  similarity: number;
}

/**
 * Nearest chunks to `embedding` by cosine distance, restricted to chunks embedded with the
 * same model (vectors from different models live in unrelated spaces).
 */
export async function searchChunks(params: {
  embedding: number[];
  embeddingModel: string;
  crops?: string[];
  limit: number;
}): Promise<ChunkMatch[]> {
  const vector = toVectorLiteral(params.embedding);
  const cropFilter =
    params.crops && params.crops.length > 0
      ? Prisma.sql`AND c.crops && ${[...params.crops, "all"]}::text[]`
      : Prisma.empty;
  const rows = await getDb().$queryRaw<
    Array<Omit<ChunkMatch, "similarity"> & { similarity: unknown }>
  >`
    SELECT c.id, c.document_id AS "documentId", d.title, d.publisher, d.url, d.region,
           d.fetched_at AS "fetchedAt", c.section, c.page_from AS "pageFrom", c.page_to AS "pageTo",
           c.crops, c.content, 1 - (c.embedding <=> ${vector}::vector) AS similarity
    FROM advisory_chunks c
    JOIN advisory_documents d ON d.id = c.document_id
    WHERE d.embedding_model = ${params.embeddingModel} ${cropFilter}
    ORDER BY c.embedding <=> ${vector}::vector
    LIMIT ${params.limit}`;
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

/** Number of searchable chunks for an embedding model (used by /api/health). */
export async function countChunks(embeddingModel: string): Promise<number> {
  const rows = await getDb().$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n
    FROM advisory_chunks c JOIN advisory_documents d ON d.id = c.document_id
    WHERE d.embedding_model = ${embeddingModel}`;
  return rows[0]?.n ?? 0;
}

/** Hash + embedding model of a stored document, to skip re-embedding unchanged sources. */
export async function getDocumentMeta(
  id: string,
): Promise<{ contentHash: string; embeddingModel: string } | null> {
  return getDb().advisoryDocument.findUnique({
    where: { id },
    select: { contentHash: true, embeddingModel: true },
  });
}
