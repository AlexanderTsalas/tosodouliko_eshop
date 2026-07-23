export default function TranslationsLoading() {
  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Μεταφράσεις</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <select className="border rounded px-3 py-1" disabled>
          <option value="">Όλα τα namespaces</option>
        </select>
        <select className="border rounded px-3 py-1" disabled>
          <option value="">Όλες οι γλώσσες</option>
        </select>
        <button type="submit" className="rounded border px-3 py-1" disabled>
          Φιλτράρισμα
        </button>
      </form>
    </>
  );
}
