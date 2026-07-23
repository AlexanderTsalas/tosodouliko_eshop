-- =============================================================================
-- Product dimensions: length, width, height (in millimeters).
--
-- Background: products.weight_g existed for shipping calculations, but many
-- couriers price by volumetric weight too (L×W×H ÷ a divisor). Without
-- dimensions we can't compute volumetric and end up paying actual weight
-- on lightweight bulky items (think: a box of plush toys).
--
-- Stored in millimeters (integer) for the same reason weight is in grams —
-- avoid floating-point drift, and millimeters covers everything from a
-- screw to a large box without overflow on smallint... but we use int4
-- to be safe (max 21.4km, way past any product size).
--
-- All three are nullable. Existing products keep working with no
-- dimensions until an admin fills them in. The carrier integration code
-- will treat NULL dimensions as "use weight only" — no behavior change
-- for products without dimensions configured.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS length_mm integer,
  ADD COLUMN IF NOT EXISTS width_mm integer,
  ADD COLUMN IF NOT EXISTS height_mm integer;

COMMENT ON COLUMN public.products.length_mm IS
  'Outer package length in millimeters. Used together with width/height for volumetric weight calculation.';
COMMENT ON COLUMN public.products.width_mm IS
  'Outer package width in millimeters.';
COMMENT ON COLUMN public.products.height_mm IS
  'Outer package height in millimeters.';

-- Defensive: dimensions must be positive when set (zero/negative is a
-- data entry mistake, NULL = unset is fine).
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_dimensions_positive;
ALTER TABLE public.products
  ADD CONSTRAINT products_dimensions_positive
  CHECK (
    (length_mm IS NULL OR length_mm > 0) AND
    (width_mm IS NULL OR width_mm > 0) AND
    (height_mm IS NULL OR height_mm > 0)
  );
