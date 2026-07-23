export default function ReturnsLoading() {
  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Αιτήσεις επιστροφής</h1>

      <nav className="flex flex-wrap gap-2 mb-4 text-sm">
        <span className="btn btn-sm btn-primary">Όλες</span>
        <span className="btn btn-sm btn-secondary">Εκκρεμείς</span>
        <span className="btn btn-sm btn-secondary">Εγκρ.</span>
        <span className="btn btn-sm btn-secondary">Απορ.</span>
        <span className="btn btn-sm btn-secondary">Επιστρ.</span>
      </nav>
    </>
  );
}
