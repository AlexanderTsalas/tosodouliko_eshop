export default function AuditLogLoading() {
  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Audit log</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <input
          name="resource"
          placeholder="resource type (π.χ. product, order)"
          className="border rounded px-3 py-1 flex-1"
          disabled
        />
        <input
          name="action"
          placeholder="action (π.χ. product.created)"
          className="border rounded px-3 py-1 flex-1"
          disabled
        />
        <button type="submit" className="rounded border px-3 py-1" disabled>
          Φιλτράρισμα
        </button>
      </form>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Time</th>
            <th className="py-2">Actor</th>
            <th className="py-2">Action</th>
            <th className="py-2">Resource</th>
            <th className="py-2">Metadata</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">
                <div className="h-3 w-32 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-3 w-24 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-3 w-32 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-3 w-40 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-8 w-64 bg-muted/20 rounded animate-pulse skeleton-reveal" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
