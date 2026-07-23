import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  StorageError,
  type AssetCoordinate,
  type ListInput,
  type ListResult,
  type PutInput,
  type PutResult,
  type ReadBytesInput,
  type SignedUploadInput,
  type SignedUploadResult,
  type SignedUrlInput,
  type StorageProvider,
} from "../types";

/**
 * SupabaseStorageProvider — implements StorageProvider against
 * Supabase Storage (S3-backed under the hood, accessed via the
 * supabase-js storage API).
 *
 * Constructor inputs:
 *   - url: NEXT_PUBLIC_SUPABASE_URL — used both for the storage API
 *     and for constructing public URLs
 *   - serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY — bypasses RLS for
 *     the storage admin operations. Provider operations are always
 *     server-side so service_role is appropriate.
 *
 * Public URL shape:
 *   {url}/storage/v1/object/public/{bucket}/{key}
 *
 * Signed URL shape (read):
 *   {url}/storage/v1/object/sign/{bucket}/{key}?token={jwt}
 *
 * Signed upload URL shape:
 *   POST {url}/storage/v1/object/upload/sign/{bucket}/{key}?token={jwt}
 *   (Supabase uses POST with a TUS-compatible resumable protocol,
 *   but supabase-js exposes a simpler PUT shape via createSignedUploadUrl.)
 *
 * Bucket conventions:
 *   - Each logical bucket maps 1:1 to a Supabase storage bucket
 *   - Public read is configured at bucket creation time in the
 *     Supabase dashboard (or via SQL on storage.buckets)
 *   - This provider does NOT create buckets; deployment provisions
 *     them via a setup script or dashboard
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private readonly client: SupabaseClient;
  private readonly baseUrl: string;

  constructor(config: { url: string; serviceRoleKey: string }) {
    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.baseUrl = config.url.replace(/\/+$/, "");
  }

  async put(input: PutInput): Promise<PutResult> {
    const cacheControl =
      input.cacheControl ??
      (input.isPublic
        ? "public, max-age=31536000, immutable"
        : "private, max-age=0, no-cache");

    // supabase-js's upload() accepts File | Blob | ArrayBuffer | string.
    // Buffer is an ArrayBufferView subclass; Uint8Array is the same.
    // ReadableStream is supported via the lower-level fetch path
    // (supabase-js auto-handles it).
    const { error } = await this.client.storage
      .from(input.bucket)
      .upload(input.key, input.body as Blob, {
        contentType: input.contentType,
        cacheControl,
        upsert: false,
      });

    if (error) {
      // supabase-js error shape doesn't have a stable code — match on
      // status/message. NotFound for missing bucket, Duplicate for
      // already-exists, other errors as PROVIDER_ERROR.
      const message = error.message ?? "Supabase upload failed";
      if (/already exists/i.test(message)) {
        throw new StorageError({
          code: "ALREADY_EXISTS",
          provider: this.name,
          message,
          cause: error,
        });
      }
      if (/bucket not found/i.test(message)) {
        throw new StorageError({
          code: "NOT_FOUND",
          provider: this.name,
          message,
          cause: error,
        });
      }
      throw new StorageError({
        code: "PROVIDER_ERROR",
        provider: this.name,
        message,
        cause: error,
      });
    }

    return { storage_key: input.key, bucket: input.bucket };
  }

  publicUrl(input: AssetCoordinate): string {
    // The supabase-js getPublicUrl() helper is synchronous; we replicate
    // its URL construction inline so callers don't pay any SDK overhead
    // on the render hot path.
    return `${this.baseUrl}/storage/v1/object/public/${encodeURIComponent(
      input.bucket
    )}/${encodePath(input.key)}`;
  }

  async signedUrl(input: SignedUrlInput): Promise<string> {
    const { data, error } = await this.client.storage
      .from(input.bucket)
      .createSignedUrl(input.key, input.ttlSeconds);
    if (error || !data) {
      throw mapSupabaseError(error, this.name, "signedUrl failed");
    }
    return data.signedUrl;
  }

  async signedUploadUrl(input: SignedUploadInput): Promise<SignedUploadResult> {
    // supabase-js createSignedUploadUrl returns a token; the client
    // performs the upload via uploadToSignedUrl(). For browser-direct
    // upload, we expose the underlying URL shape so any HTTP client
    // (including non-supabase-js) can use it.
    const { data, error } = await this.client.storage
      .from(input.bucket)
      .createSignedUploadUrl(input.key);
    if (error || !data) {
      throw mapSupabaseError(error, this.name, "signedUploadUrl failed");
    }
    return {
      url: data.signedUrl,
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
      },
    };
  }

  async delete(input: AssetCoordinate): Promise<void> {
    const { error } = await this.client.storage
      .from(input.bucket)
      .remove([input.key]);
    if (error) {
      // Supabase Storage's remove() reports "Not Found" for missing
      // keys; treat as success (idempotent contract).
      if (/not found/i.test(error.message)) return;
      throw mapSupabaseError(error, this.name, "delete failed");
    }
  }

  async exists(input: AssetCoordinate): Promise<boolean> {
    const { data, error } = await this.client.storage
      .from(input.bucket)
      .list(extractDirname(input.key), {
        search: extractBasename(input.key),
        limit: 1,
      });
    if (error) {
      throw mapSupabaseError(error, this.name, "exists failed");
    }
    return (data ?? []).length > 0;
  }

  async readBytes(input: ReadBytesInput): Promise<Uint8Array> {
    // Supabase Storage's download() returns the full object as a Blob.
    // No native range-fetch in supabase-js; we fetch the whole object
    // and slice client-side. For magic-byte verification (16 bytes) the
    // overhead is acceptable because the typical product image is 1-4MB
    // and this only fires once at upload-time.
    //
    // Future: drop down to the underlying HTTP API with a Range header
    // for genuine byte-range fetching. For now, simplicity wins.
    const { data, error } = await this.client.storage
      .from(input.bucket)
      .download(input.key);
    if (error || !data) {
      throw mapSupabaseError(error, this.name, "readBytes failed");
    }
    const buf = await data.arrayBuffer();
    return new Uint8Array(buf).slice(0, input.length);
  }

  async list(input: ListInput): Promise<ListResult> {
    // supabase-js .list() doesn't return a continuation token in the
    // S3 sense — it uses offset-based pagination. We synthesize the
    // token as the next offset value.
    //
    // Returns ListedObject entries with epoch-ms timestamps from the
    // updated_at field (falls back to created_at). The reaper uses
    // these to age-filter candidates.
    const offset = input.continuationToken
      ? parseInt(input.continuationToken, 10)
      : 0;
    const limit = Math.min(input.maxKeys ?? 1000, 1000);
    const prefix = input.prefix ?? "";
    const { data, error } = await this.client.storage
      .from(input.bucket)
      .list(prefix, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) {
      throw mapSupabaseError(error, this.name, "list failed");
    }
    const items = data ?? [];
    const objects = items
      .filter((it) => it.name)
      .map((it) => {
        const isoTimestamp =
          (it.updated_at as string | undefined) ??
          (it.created_at as string | undefined);
        const parsed = isoTimestamp ? Date.parse(isoTimestamp) : 0;
        return {
          key: prefix ? `${prefix}/${it.name}` : it.name,
          lastModifiedMs: isNaN(parsed) ? 0 : parsed,
        };
      });
    const nextToken = items.length === limit ? String(offset + limit) : undefined;
    return { objects, nextToken };
  }
}

function extractDirname(key: string): string {
  const lastSlash = key.lastIndexOf("/");
  return lastSlash === -1 ? "" : key.slice(0, lastSlash);
}

function extractBasename(key: string): string {
  const lastSlash = key.lastIndexOf("/");
  return lastSlash === -1 ? key : key.slice(lastSlash + 1);
}

/** Encode path components individually so slashes survive. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function mapSupabaseError(
  err: { message?: string } | null,
  provider: "supabase",
  fallback: string
): StorageError {
  return new StorageError({
    code: "PROVIDER_ERROR",
    provider,
    message: err?.message ?? fallback,
    cause: err,
  });
}
