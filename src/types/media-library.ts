export interface MediaAsset {
  id: string;
  uploader_id: string | null;
  bucket: string;
  storage_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  alt_text: string | null;
  folder: string | null;
  is_public: boolean;
  created_at: string;
}

export interface UploadMediaInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  bucket?: string;
  folder?: string;
  altText?: string;
  isPublic?: boolean;
}
