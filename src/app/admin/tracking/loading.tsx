export default function TrackingLoading() {
  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Tracking events</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <input
          name="event"
          placeholder="event_name (π.χ. page_view, add_to_cart)"
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
            <th className="py-2">Session</th>
            <th className="py-2">User</th>
            <th className="py-2">Event</th>
            <th className="py-2">URL</th>
            <th className="py-2">Properties</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">
                <div className="h-3 w-32 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-3 w-16 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-3 w-16 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-3 w-24 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-3 w-40 bg-muted/30 rounded animate-pulse skeleton-reveal" />
              </td>
              <td className="py-2">
                <div className="h-8 w-48 bg-muted/20 rounded animate-pulse skeleton-reveal" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
