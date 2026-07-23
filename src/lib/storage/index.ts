import "server-only";
import type {
  AssetCoordinate,
  Bucket,
  StorageKey,
  StorageProvider,
} from "./types";

/**
 * The default logical bucket name for product images. Each deployment
 * provisions a bucket with this name on its chosen provider (Supabase
 * dashboard, R2 dashboard, MinIO console, etc.). Read on the storefront
 * via `getImageUrl()`.
 *
 * Per-bucket override is supported per row — `product_images.bucket`
 * column (added in the schema migration that accompanies this work)
 * lets a single row point at a different bucket if needed (e.g.
 * variant-specific buckets, marketplace-uploaded images, etc.).
 */
export const DEFAULT_PRODUCT_IMAGES_BUCKET = "product-images";

/**
 * Singleton provider instance. Resolved once at first use; cached for
 * the lifetime of the Node process. The factory is async because the S3
 * provider's SDK is dynamically imported (so Supabase-only deployments
 * don't pay the dep cost), but every subsequent call after first
 * resolution returns the cached instance synchronously through the
 * `getStorageProviderSync()` accessor (after `await initStorage()` has
 * run at startup, see below).
 */
let _provider: StorageProvider | null = null;
let _providerPromise: Promise<StorageProvider> | null = null;

/**
 * Resolves and caches the active provider. Subsequent calls return the
 * same promise (and once resolved, return immediately via the cached
 * instance).
 *
 * Callers that need sync access can either (a) await this once at
 * application startup so the cache is warm, or (b) always call this
 * async variant.
 */
export async function getStorageProvider(): Promise<StorageProvider> {
  if (_provider) return _provider;
  if (_providerPromise) return _providerPromise;

  _providerPromise = (async () => {
    const name = (process.env.STORAGE_PROVIDER ?? "supabase").toLowerCase();
    switch (name) {
      case "supabase": {
        const { SupabaseStorageProvider } = await import(
          "./providers/supabase"
        );
        const url =
          process.env.NEXT_PUBLIC_SUPABASE_URL ??
          throwMissingEnv("NEXT_PUBLIC_SUPABASE_URL");
        const serviceRoleKey =
          process.env.SUPABASE_SERVICE_ROLE_KEY ??
          throwMissingEnv("SUPABASE_SERVICE_ROLE_KEY");
        _provider = new SupabaseStorageProvider({ url, serviceRoleKey });
        return _provider;
      }
      case "s3":
      case "r2":
      case "minio":
      case "b2": {
        const { S3CompatProvider } = await import("./providers/s3-compat");
        const endpoint =
          process.env.S3_ENDPOINT ?? throwMissingEnv("S3_ENDPOINT");
        const region = process.env.S3_REGION ?? "auto";
        const accessKeyId =
          process.env.S3_ACCESS_KEY_ID ??
          throwMissingEnv("S3_ACCESS_KEY_ID");
        const secretAccessKey =
          process.env.S3_SECRET_ACCESS_KEY ??
          throwMissingEnv("S3_SECRET_ACCESS_KEY");
        const publicUrlBase = process.env.S3_PUBLIC_URL_BASE;
        const forcePathStyle =
          process.env.S3_FORCE_PATH_STYLE === "false" ? false : true;
        _provider = new S3CompatProvider({
          endpoint,
          region,
          accessKeyId,
          secretAccessKey,
          publicUrlBase,
          forcePathStyle,
        });
        return _provider;
      }
      default:
        throw new Error(
          `Unknown STORAGE_PROVIDER: ${name}. Valid values: supabase, s3, r2, minio, b2`
        );
    }
  })();

  return _providerPromise;
}

/**
 * Sync accessor for the cached provider. Throws if `getStorageProvider()`
 * has never been awaited — must run startup-time initialization first.
 *
 * Used on the storefront render hot path where `await` would add
 * unwanted serialization to otherwise synchronous URL construction.
 * Server components/actions that have already touched storage will have
 * the cache primed; cold-start paths should `await getStorageProvider()`
 * to warm the cache.
 */
export function getStorageProviderSync(): StorageProvider {
  if (!_provider) {
    throw new Error(
      "StorageProvider not initialized. Call `await getStorageProvider()` " +
        "at application startup, or use the async variant."
    );
  }
  return _provider;
}

/**
 * Construct a public URL for an asset given its storage_key.
 *
 * Convenience over `(await getStorageProvider()).publicUrl({...})`.
 * Async because the provider may not be initialized yet; subsequent
 * calls within the same request hit the warm cache and are effectively
 * synchronous.
 *
 * When the application transitions from legacy URL-coupled rows
 * (`product_images.url`) to abstracted ones (`product_images.storage_key`),
 * call sites use {@link resolveImageUrl} which handles both shapes.
 */
export async function getImageUrl(
  storage_key: StorageKey,
  bucket: Bucket = DEFAULT_PRODUCT_IMAGES_BUCKET
): Promise<string> {
  const provider = await getStorageProvider();
  return provider.publicUrl({ bucket, key: storage_key });
}

/**
 * Transitional helper: resolves the public URL of a `product_images`
 * row whether it has been migrated to the abstraction (has `storage_key`)
 * or is still in the legacy URL-coupled state (has only `url`).
 *
 * After all rows are migrated and the legacy `url` column is dropped,
 * call sites should switch to `getImageUrl()` directly.
 */
export async function resolveImageUrl(image: {
  url?: string | null;
  storage_key?: string | null;
  bucket?: string | null;
}): Promise<string | null> {
  if (image.storage_key) {
    return getImageUrl(
      image.storage_key,
      image.bucket ?? DEFAULT_PRODUCT_IMAGES_BUCKET
    );
  }
  return image.url ?? null;
}

/**
 * Sync version of `resolveImageUrl` for render hot paths where the
 * provider cache is already warm. Throws if the provider isn't
 * initialized (must `await getStorageProvider()` once before using).
 *
 * Use this in client component prop construction:
 *
 *     // In server component:
 *     const url = resolveImageUrlSync(image);
 *     return <ProductCard image={url} ... />;
 */
export function resolveImageUrlSync(image: {
  url?: string | null;
  storage_key?: string | null;
  bucket?: string | null;
}): string | null {
  if (image.storage_key) {
    const provider = getStorageProviderSync();
    return provider.publicUrl({
      bucket: image.bucket ?? DEFAULT_PRODUCT_IMAGES_BUCKET,
      key: image.storage_key,
    });
  }
  return image.url ?? null;
}

/**
 * Re-export the AssetCoordinate type for callers that need to pass
 * around bucket+key together.
 */
export type { AssetCoordinate, Bucket, StorageKey, StorageProvider };
export { StorageError } from "./types";

function throwMissingEnv(name: string): never {
  throw new Error(
    `Missing required env var for STORAGE_PROVIDER configuration: ${name}`
  );
}
