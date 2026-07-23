export default function MediaLoading() {
  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Αρχεία</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <select className="border rounded px-3 py-1" disabled>
          <option value="">Όλοι οι φάκελοι</option>
        </select>
        <select className="border rounded px-3 py-1" disabled>
          <option value="">Όλοι οι τύποι</option>
          <option value="image">Εικόνες μόνο</option>
        </select>
        <button type="submit" className="rounded border px-3 py-1" disabled>
          Φιλτράρισμα
        </button>
      </form>
    </>
  );
}
