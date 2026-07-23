export interface Translation {
  id: string;
  namespace: string;
  key: string;
  locale: string;
  value: string;
  updated_at: string;
}

export type TranslationMap = Record<string, string>;
