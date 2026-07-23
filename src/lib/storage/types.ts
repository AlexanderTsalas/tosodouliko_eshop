import "server-only";

/**
 * Logical bucket name. Buckets organize assets by domain
 * (`"products"`, `"categories"`, `"users"`, …). The provider implementation
 * maps these to its own bucket convention — Supabase buckets, S3 buckets,
 * etc. Callers always use logical names.
 */
export type Bucket = string;

/**
 * The opaque object key — path within a bucket. Includes any
 * sub-folders. Example: `"abc-uuid/hero.jpg"`.
 *
 * Provider-agnostic: a `storage_key` recorded in the DB is the same
 * string regardless of which provider holds the bytes. Migrating
 * providers means moving bytes between backends with the same key,
 * not rewriting database rows.
 */
export type StorageKey = string;

/**
 * The body of an asset being uploaded. Server-only — covers the
 * common server-side body shapes Node and the Fetch API expose.
 */
export type AssetBody = Buffer | Uint8Array | Blob | ReadableStream<Uint8Array>;

/**
 * Inputs to {@link StorageProvider.put}.
 */
export interface PutInput {
  bucket: Bucket;
  key: StorageKey;
  body: AssetBody;
  contentType: string;
  /**
   * Optional Cache-Control header for HTTP delivery. Defaults to
   * `"public, max-age=31536000, immutable"` for public assets and
   * `"private, max-age=0, no-cache"` for private.
   *
   * Immutable is correct when the application embeds a UUID or content
   * hash in the key, so the (bucket, key) pair uniquely identifies the
   * bytes for their entire lifetime.
   */
  cacheControl?: string;
  /**
   * When `true`, the asset is uploaded into the provider's
   * public-readable bucket and `publicUrl()` returns a valid URL.
   *
   * When `false` (default), the asset goes into a private bucket and
   * is only accessible via `signedUrl()`.
   */
  isPublic?: boolean;
}

/**
 * Inputs to URL-construction methods. Just the bucket + key.
 */
export interface AssetCoordinate {
  bucket: Bucket;
  key: StorageKey;
}

/**
 * Inputs to {@link StorageProvider.signedUrl}.
 */
export interface SignedUrlInput extends AssetCoordinate {
  /**
   * Time-to-live in seconds. Provider implementations may clamp this
   * to their own limits (R2 allows up to 7 days; AWS S3 up to 7 days
   * by default; Supabase up to 24 hours unless overridden).
   */
  ttlSeconds: number;
}

/**
 * Inputs to {@link StorageProvider.signedUploadUrl}. Used to give
 * a browser direct upload access to a key without proxying bytes
 * through a serverless function (bypasses Vercel's 4.5MB request
 * body limit + saves egress).
 */
export interface SignedUploadInput extends AssetCoordinate {
  contentType: string;
  ttlSeconds: number;
  /**
   * Optional maximum body size. If unset, the provider's default
   * applies. Defending against runaway uploads — set to a sensible
   * cap (e.g. 20 MB for product images).
   */
  maxBytes?: number;
}

/**
 * The return shape of {@link StorageProvider.signedUploadUrl}.
 * Supports both PUT (S3, R2, Supabase) and POST (form-based) flows.
 */
export interface SignedUploadResult {
  url: string;
  method: "PUT" | "POST";
  /**
   * Required headers the client must send on the upload request.
   * For S3-compat: `{"Content-Type": "image/jpeg"}` at minimum.
   * For POST flows (Supabase resumable, AWS S3 presigned POST): the
   * fields map to multipart-form fields, not headers.
   */
  headers?: Record<string, string>;
  fields?: Record<string, string>;
}

/**
 * Result of {@link StorageProvider.put}.
 */
export interface PutResult {
  /** The storage_key the application records in media_assets / product_images. */
  storage_key: StorageKey;
  /** The bucket the asset was written to. */
  bucket: Bucket;
}

/**
 * Inputs to {@link StorageProvider.readBytes}. Reads the first
 * `length` bytes of an object for magic-byte verification.
 */
export interface ReadBytesInput extends AssetCoordinate {
  /** Number of bytes to read from the start of the object. */
  length: number;
}

/**
 * Inputs to {@link StorageProvider.list}. Paginated key listing.
 */
export interface ListInput {
  bucket: Bucket;
  /** Optional prefix to restrict to objects under a virtual folder. */
  prefix?: string;
  /** Continuation token from a previous page, if any. */
  continuationToken?: string;
  /** Max keys per page. Provider may clamp this (S3 caps at 1000). */
  maxKeys?: number;
}

/**
 * One entry in a {@link StorageProvider.list} result.
 */
export interface ListedObject {
  key: StorageKey;
  /**
   * Last-modified timestamp in epoch milliseconds. Used by the orphan
   * reaper to age-filter candidates (objects must be older than the
   * retention window before being eligible for deletion).
   */
  lastModifiedMs: number;
}

/**
 * Result of {@link StorageProvider.list}.
 */
export interface ListResult {
  objects: ListedObject[];
  /** Present when more pages remain. Pass back as `continuationToken`. */
  nextToken?: string;
}

/**
 * The provider-agnostic storage interface.
 *
 * Every method is server-side only — callers go through this
 * abstraction rather than importing the underlying SDK (`@supabase/...`
 * or `@aws-sdk/...`) directly. The active provider is resolved at
 * startup from the `STORAGE_PROVIDER` env var.
 *
 * Architectural promise: a single `STORAGE_PROVIDER=` env var change
 * + provider-specific config swaps where bytes live. No application
 * code changes; no database row rewrites.
 *
 * Naming: methods that return synchronously (URL construction) do so;
 * methods that hit the wire (uploads, signed-URL generation) are async.
 * Implementations are responsible for hiding network errors behind
 * structured failures — a `put()` that the network refused must throw
 * `StorageError`, not propagate the raw SDK error.
 */
export interface StorageProvider {
  /**
   * Identifier of the active provider. Used for logging + audit
   * metadata + the migration tracking on media_assets.provider_at_upload.
   */
  readonly name: "supabase" | "s3" | "local";

  /**
   * Upload bytes. Returns the (bucket, storage_key) the application
   * records in DB. Throws StorageError on failure.
   */
  put(input: PutInput): Promise<PutResult>;

  /**
   * Returns a URL the browser can fetch for a publicly-readable asset.
   * Synchronous — pure string construction.
   *
   * Throws if the bucket is not public-readable on this provider.
   * (Callers are expected to know whether a bucket is public; the
   * `media_assets.is_public` column is the source of truth.)
   */
  publicUrl(input: AssetCoordinate): string;

  /**
   * Returns a presigned URL for reading a private asset.
   */
  signedUrl(input: SignedUrlInput): Promise<string>;

  /**
   * Returns a presigned URL the browser can PUT bytes to directly.
   * Avoids round-tripping the upload through a serverless function
   * (which has body-size limits on Vercel).
   *
   * Recommended pattern:
   *   1. Admin client requests signed upload URL from server action
   *   2. Server action returns { url, method, headers } from this
   *   3. Browser PUTs bytes directly to the storage backend
   *   4. Browser tells server action "upload complete," server records
   *      the row in media_assets via `put()` is NOT called — record
   *      directly. (`put()` is for server-driven uploads only.)
   */
  signedUploadUrl(input: SignedUploadInput): Promise<SignedUploadResult>;

  /**
   * Delete an asset. Idempotent: deleting a non-existent key returns
   * success without error.
   */
  delete(input: AssetCoordinate): Promise<void>;

  /**
   * Returns `true` if an object exists. Useful for migration scripts
   * and admin tooling; not on the request hot path.
   */
  exists(input: AssetCoordinate): Promise<boolean>;

  /**
   * Reads the first `length` bytes of an object. Used for server-side
   * magic-byte verification (verify uploaded file format matches the
   * declared MIME type — defense in depth against client-side
   * conversion bypass).
   *
   * Throws `StorageError` with code `NOT_FOUND` if the object doesn't
   * exist.
   */
  readBytes(input: ReadBytesInput): Promise<Uint8Array>;

  /**
   * Lists object keys in a bucket, optionally filtered by prefix.
   * Paginated via continuation token. Used by the orphan reaper +
   * admin tooling, NOT on the request hot path.
   */
  list(input: ListInput): Promise<ListResult>;
}

/**
 * Discriminated storage error. Implementations wrap their SDK's
 * native errors in this shape so callers can pattern-match without
 * importing the SDK.
 */
export class StorageError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "ALREADY_EXISTS"
    | "NETWORK_ERROR"
    | "INVALID_BODY"
    | "PROVIDER_ERROR";
  readonly provider: StorageProvider["name"];
  readonly cause?: unknown;

  constructor(args: {
    code: StorageError["code"];
    provider: StorageProvider["name"];
    message: string;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "StorageError";
    this.code = args.code;
    this.provider = args.provider;
    this.cause = args.cause;
  }
}
