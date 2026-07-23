import "server-only";
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
 * S3CompatProvider — implements StorageProvider against any
 * S3-compatible object store: Cloudflare R2, AWS S3, MinIO (self-hosted
 * S3), Backblaze B2, Wasabi.
 *
 * Selection in the factory:
 *
 *     STORAGE_PROVIDER=s3
 *     S3_ENDPOINT=<provider endpoint>
 *     S3_REGION=<region or "auto">
 *     S3_ACCESS_KEY_ID=<key>
 *     S3_SECRET_ACCESS_KEY=<secret>
 *     S3_PUBLIC_URL_BASE=<public read base URL>  (optional)
 *     S3_FORCE_PATH_STYLE=<true|false>            (default true)
 *
 * Endpoint per backend:
 *
 *     R2:       https://<account-id>.r2.cloudflarestorage.com
 *     S3:       https://s3.<region>.amazonaws.com
 *     MinIO:    https://<vps-domain>:9000
 *     B2:       https://s3.<region>.backblazeb2.com
 *
 * Public URL strategy: the provider supports two modes via
 * `S3_PUBLIC_URL_BASE`:
 *
 *   1. Endpoint-based (default): `${endpoint}/${bucket}/${key}` — only
 *      works if the bucket is configured public-read. Workable for R2
 *      with public buckets enabled.
 *
 *   2. Custom domain (recommended): set `S3_PUBLIC_URL_BASE=https://cdn.yourshop.gr`
 *      and the provider emits `https://cdn.yourshop.gr/${bucket}/${key}`.
 *      Cloudflare R2 can be exposed at a custom domain for free; AWS S3
 *      via CloudFront; MinIO via the reverse proxy in front of it.
 *
 * Dependency requirement (NOT pre-installed in this repo):
 *
 *     npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 * The factory dynamically imports this module ONLY when
 * `STORAGE_PROVIDER=s3`, so Supabase-only deployments never pay the
 * dependency cost.
 *
 * Types from the AWS SDK are not statically imported (the package
 * isn't required by deployments that don't use S3). Constructor + the
 * lazy SDK getter narrow `any` to the SDK shape only when needed.
 */
export interface S3CompatConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlBase?: string;
  /** Default true for R2 + MinIO; AWS S3 (virtual-host) is false. */
  forcePathStyle?: boolean;
}

export class S3CompatProvider implements StorageProvider {
  readonly name = "s3";
  private readonly config: S3CompatConfig;
  // Lazy-loaded SDK handles. `any` because the SDK isn't a static dep.
  private client: any = null;
  private getSignedUrlFn: ((client: any, command: any, opts?: any) => Promise<string>) | null = null;

  constructor(config: S3CompatConfig) {
    this.config = {
      ...config,
      forcePathStyle: config.forcePathStyle ?? true,
    };
  }

  private async loadSdk(): Promise<{ client: any; SDK: any; getSignedUrl: any }> {
    if (this.client && this.getSignedUrlFn) {
      const SDK = await loadClientS3();
      return { client: this.client, SDK, getSignedUrl: this.getSignedUrlFn };
    }
    const SDK = await loadClientS3();
    const presigner = await loadPresigner();
    if (!this.client) {
      this.client = new SDK.S3Client({
        endpoint: this.config.endpoint,
        region: this.config.region,
        forcePathStyle: this.config.forcePathStyle,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
      });
    }
    if (!this.getSignedUrlFn) {
      this.getSignedUrlFn = presigner.getSignedUrl;
    }
    return { client: this.client, SDK, getSignedUrl: this.getSignedUrlFn! };
  }

  async put(input: PutInput): Promise<PutResult> {
    const { client, SDK } = await this.loadSdk();
    try {
      await client.send(
        new SDK.PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body as any,
          ContentType: input.contentType,
          CacheControl:
            input.cacheControl ??
            (input.isPublic
              ? "public, max-age=31536000, immutable"
              : "private, max-age=0, no-cache"),
        })
      );
    } catch (err) {
      throw mapSdkError(err, this.name);
    }
    return { storage_key: input.key, bucket: input.bucket };
  }

  publicUrl(input: AssetCoordinate): string {
    // Custom-domain mode preferred. Falls back to endpoint+bucket form.
    if (this.config.publicUrlBase) {
      const base = this.config.publicUrlBase.replace(/\/+$/, "");
      return `${base}/${encodeURIComponent(input.bucket)}/${encodePath(input.key)}`;
    }
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    return this.config.forcePathStyle
      ? `${endpoint}/${encodeURIComponent(input.bucket)}/${encodePath(input.key)}`
      : `https://${input.bucket}.${endpoint.replace(/^https?:\/\//, "")}/${encodePath(input.key)}`;
  }

  async signedUrl(input: SignedUrlInput): Promise<string> {
    const { client, SDK, getSignedUrl } = await this.loadSdk();
    try {
      const command = new SDK.GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      });
      return await getSignedUrl(client, command, {
        expiresIn: input.ttlSeconds,
      });
    } catch (err) {
      throw mapSdkError(err, this.name);
    }
  }

  async signedUploadUrl(input: SignedUploadInput): Promise<SignedUploadResult> {
    const { client, SDK, getSignedUrl } = await this.loadSdk();
    try {
      const command = new SDK.PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ...(input.maxBytes ? { ContentLength: input.maxBytes } : {}),
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: input.ttlSeconds,
      });
      return {
        url,
        method: "PUT",
        headers: {
          "Content-Type": input.contentType,
          ...(input.maxBytes
            ? { "Content-Length": String(input.maxBytes) }
            : {}),
        },
      };
    } catch (err) {
      throw mapSdkError(err, this.name);
    }
  }

  async delete(input: AssetCoordinate): Promise<void> {
    const { client, SDK } = await this.loadSdk();
    try {
      await client.send(
        new SDK.DeleteObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
        })
      );
    } catch (err) {
      // S3 DELETE is idempotent at the protocol level — it doesn't
      // raise NotFound. Other errors propagate.
      throw mapSdkError(err, this.name);
    }
  }

  async exists(input: AssetCoordinate): Promise<boolean> {
    const { client, SDK } = await this.loadSdk();
    try {
      await client.send(
        new SDK.HeadObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
        })
      );
      return true;
    } catch (err: any) {
      // SDK throws NotFound (404) — recognize and return false. Other
      // errors propagate as StorageError.
      const name = err?.name ?? err?.Code ?? "";
      const status = err?.$metadata?.httpStatusCode ?? 0;
      if (name === "NotFound" || name === "NoSuchKey" || status === 404) {
        return false;
      }
      throw mapSdkError(err, this.name);
    }
  }

  async readBytes(input: ReadBytesInput): Promise<Uint8Array> {
    // Genuine byte-range fetch via HTTP Range header. Cheap — only the
    // first N bytes leave R2.
    const { client, SDK } = await this.loadSdk();
    try {
      const response = await client.send(
        new SDK.GetObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Range: `bytes=0-${input.length - 1}`,
        })
      );
      // response.Body is a ReadableStream | Blob | Uint8Array depending
      // on environment. Use transformToByteArray for normalization.
      const bytes: Uint8Array = await response.Body.transformToByteArray();
      // R2 may return more than requested if the file is smaller; clip.
      return bytes.slice(0, input.length);
    } catch (err) {
      throw mapSdkError(err, this.name);
    }
  }

  async list(input: ListInput): Promise<ListResult> {
    const { client, SDK } = await this.loadSdk();
    try {
      const response = await client.send(
        new SDK.ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: input.prefix,
          ContinuationToken: input.continuationToken,
          MaxKeys: Math.min(input.maxKeys ?? 1000, 1000),
        })
      );
      const objects = (response.Contents ?? [])
        .filter(
          (obj: { Key?: string }): obj is { Key: string; LastModified?: Date } =>
            Boolean(obj.Key)
        )
        .map((obj: { Key: string; LastModified?: Date }) => ({
          key: obj.Key,
          // S3 / R2 return LastModified as a Date object.
          lastModifiedMs: obj.LastModified ? obj.LastModified.getTime() : 0,
        }));
      return {
        objects,
        nextToken: response.IsTruncated
          ? response.NextContinuationToken
          : undefined,
      };
    } catch (err) {
      throw mapSdkError(err, this.name);
    }
  }
}

/**
 * Lazy-load the SDK. Throws a clear error if the package isn't
 * installed — deployments using STORAGE_PROVIDER=s3 must run:
 *
 *     npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 * The Function-constructor pattern hides the import path from
 * webpack/turbopack static analysis. A plain `await import("...")`
 * would fail the BUILD even on Supabase-only deployments where the
 * SDK isn't installed, because the bundler resolves module
 * identifiers at build time regardless of whether the code path is
 * reachable. Building via runtime-evaluated strings keeps the build
 * green; the runtime call only fires when STORAGE_PROVIDER=s3.
 */
 
const opaqueImport = new Function("name", "return import(name)") as (
  name: string
) => Promise<any>;

async function loadClientS3(): Promise<any> {
  try {
    return await opaqueImport("@aws-sdk/client-s3");
  } catch (err) {
    throw new StorageError({
      code: "PROVIDER_ERROR",
      provider: "s3",
      message:
        "@aws-sdk/client-s3 is not installed. Install it to use STORAGE_PROVIDER=s3:\n" +
        "  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner",
      cause: err,
    });
  }
}

async function loadPresigner(): Promise<any> {
  try {
    return await opaqueImport("@aws-sdk/s3-request-presigner");
  } catch (err) {
    throw new StorageError({
      code: "PROVIDER_ERROR",
      provider: "s3",
      message: "@aws-sdk/s3-request-presigner is not installed.",
      cause: err,
    });
  }
}

function mapSdkError(err: unknown, provider: "s3"): StorageError {
  // eslint-disable-next-line
  const e = err as any;
  const name = e?.name ?? "";
  const status = e?.$metadata?.httpStatusCode ?? 0;
  if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
    return new StorageError({
      code: "NOT_FOUND",
      provider,
      message: e?.message ?? "object not found",
      cause: err,
    });
  }
  if (status === 403 || name === "AccessDenied") {
    return new StorageError({
      code: "FORBIDDEN",
      provider,
      message: e?.message ?? "access denied",
      cause: err,
    });
  }
  return new StorageError({
    code: "PROVIDER_ERROR",
    provider,
    message: e?.message ?? "S3 SDK error",
    cause: err,
  });
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
