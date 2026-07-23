# Storage abstraction

Provider-agnostic object storage. The application calls a single
`StorageProvider` interface; deployment chooses the concrete provider
via the `STORAGE_PROVIDER` env var. **The application code never imports
a provider directly.**

## Why this exists

This codebase is a CMS meant to be deployed against multiple business
backends. Hard-coding Supabase Storage (or any other paid provider)
into the application code would force every downstream deployment to
adopt the same vendor. The abstraction lets a deployment pick from:

- **Supabase Storage** — easy default for the reference deployment
- **Cloudflare R2** — best free-tier economics (10 GB free, unlimited egress)
- **AWS S3** — when you're already in AWS
- **MinIO** — self-hosted S3-compatible, for VPS-only deployments
- **Backblaze B2** — cheapest cold storage
- **Vercel Blob** — single-vendor convenience (skipped — bad economics)

Migrating between any of these is one env var change + a one-time data
move. No application code rewrites; no database row rewrites.

## Quick start

### Supabase (default)

No additional setup. The factory uses the existing
`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars.

```env
STORAGE_PROVIDER=supabase
IMAGE_HOSTNAMES=**.supabase.co
```

Create buckets via the Supabase dashboard — at minimum a
`product-images` bucket with public read enabled.

### Cloudflare R2

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```env
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=<r2-access-key>
S3_SECRET_ACCESS_KEY=<r2-secret>
S3_PUBLIC_URL_BASE=https://cdn.yourshop.gr
IMAGE_HOSTNAMES=cdn.yourshop.gr
```

Create buckets via the R2 dashboard. Map a custom domain (`cdn.yourshop.gr`)
to the bucket for clean public URLs — Cloudflare does this for free.

### MinIO on VPS

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```env
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://storage.yourshop.gr:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=<minio-key>
S3_SECRET_ACCESS_KEY=<minio-secret>
S3_PUBLIC_URL_BASE=https://storage.yourshop.gr
S3_FORCE_PATH_STYLE=true
IMAGE_HOSTNAMES=storage.yourshop.gr
```

MinIO Docker setup:

```yaml
# docker-compose.yml fragment
minio:
  image: minio/minio
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: <admin>
    MINIO_ROOT_PASSWORD: <password>
  volumes:
    - minio-data:/data
  ports:
    - "9000:9000"  # API
    - "9001:9001"  # Console
```

### AWS S3

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```env
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
S3_REGION=eu-central-1
S3_ACCESS_KEY_ID=<aws-key>
S3_SECRET_ACCESS_KEY=<aws-secret>
S3_FORCE_PATH_STYLE=false
S3_PUBLIC_URL_BASE=https://d123.cloudfront.net
IMAGE_HOSTNAMES=d123.cloudfront.net
```

Set `S3_FORCE_PATH_STYLE=false` so URLs use the virtual-host form AWS
prefers. Point a CloudFront distribution at the bucket and put its
domain in `S3_PUBLIC_URL_BASE`.

## How the application code uses it

### Public URL (storefront render path)

```ts
import { resolveImageUrl } from "@/lib/storage";

// In a server component:
const url = await resolveImageUrl(productImage);
return <Image src={url ?? "/placeholder.png"} ... />;
```

`resolveImageUrl` handles the transition window: rows with a
`storage_key` go through the active provider; legacy URL-coupled rows
fall back to their stored URL.

### Server-side upload (admin actions)

```ts
import { getStorageProvider } from "@/lib/storage";

const provider = await getStorageProvider();
const { storage_key, bucket } = await provider.put({
  bucket: "product-images",
  key: `${productId}/${randomUUID()}.jpg`,
  body: fileBuffer,
  contentType: "image/jpeg",
  isPublic: true,
});

// Then record in DB:
await admin.from("product_images").insert({
  product_id: productId,
  storage_key,
  bucket,
  alt_text: alt,
});
```

### Browser-direct upload (bypasses Vercel's 4.5 MB payload limit)

```ts
// Server action (returns presigned URL to browser):
import { getStorageProvider } from "@/lib/storage";

export async function getProductImageUploadUrl(input: {
  productId: string;
  contentType: string;
}) {
  const key = `${input.productId}/${randomUUID()}.${ext}`;
  const provider = await getStorageProvider();
  const { url, method, headers } = await provider.signedUploadUrl({
    bucket: "product-images",
    key,
    contentType: input.contentType,
    ttlSeconds: 300,  // 5 minutes
    maxBytes: 20 * 1024 * 1024,  // 20 MB cap
  });
  return { url, method, headers, key };
}

// Client:
const { url, method, headers, key } = await getProductImageUploadUrl({...});
await fetch(url, { method, headers, body: file });
// Then notify the server the upload completed:
await recordProductImage({ productId, key });
```

This pattern avoids the Vercel serverless body-size limit and saves
egress (file goes browser → R2 directly, not browser → Vercel → R2).

## Bucket conventions

Each logical bucket name is consistent across all providers. The
application uses these names:

- `product-images` — primary product photography (PDP hero, gallery)
- `category-images` — category landing page heroes
- `media-library` — admin-uploaded reusable assets
- `user-avatars` — customer profile photos (private)

The deployment provisions buckets with these names on its provider.
The provider does NOT auto-create buckets — that's a setup-time
operation (Supabase dashboard, R2 dashboard, MinIO console).

Visibility:

- `product-images`, `category-images`, `media-library` — public read
- `user-avatars` — private, accessed via `signedUrl()`

## Migration path

1. **Now (this work):** Abstraction landed. Existing deployments continue
   using Supabase Storage with no change. `product_images.storage_key`
   column added; backfilled from existing URLs.

2. **Next:** Image upload actions migrate to write `storage_key + bucket`
   instead of `url`. Reads use `resolveImageUrl()` which handles both.

3. **Later (when ready):** Migrate to R2 by:
   - Provisioning R2 buckets
   - Setting `STORAGE_PROVIDER=s3` + R2 env vars
   - Running a one-time script: read every Supabase Storage object, write
     to R2 with the same key. Application reads switch automatically.

4. **Cleanup:** Drop the legacy `product_images.url` column.

## What's intentionally NOT abstracted

- **Image transformation** — Next.js Image (`next/image`) handles
  resizing + AVIF/WebP encoding via Vercel's edge optimizer. The
  storage provider only stores raw bytes.

- **CDN caching** — Vercel's edge cache handles this for transformed
  variants. Cloudflare cache handles it for original-byte reads from R2.
  Not the storage layer's concern.

- **Bucket creation** — buckets are infrastructure, not application
  state. Provisioned at deployment setup, not at runtime.

## Limits to be aware of

- **Supabase storage:** 1 GB on free tier, $25/mo Pro gets 100 GB.
- **R2:** 10 GB free, unlimited egress, $0.015/GB above.
- **Vercel image optimization (separate from storage):** Pro tier 5,000
  source images, 100k transformations/mo. Above that you pay $5/mo per
  1,000 extra source images. For a kids eshop with ~2,000 SKUs ×
  ~8 images = ~16,000 source images, Pro is not enough — switch to
  Cloudflare Images at that point.

## Files in this directory

```
src/lib/storage/
├── types.ts                     # StorageProvider interface + types
├── index.ts                     # Factory + helpers (getStorageProvider, getImageUrl, resolveImageUrl)
├── providers/
│   ├── supabase.ts             # SupabaseStorageProvider
│   └── s3-compat.ts            # S3CompatProvider (R2/AWS/MinIO/B2)
└── README.md                    # This file
```

No barrel exports beyond what's re-exported from `index.ts` — callers
import from `@/lib/storage`, never from `@/lib/storage/providers/*`.
