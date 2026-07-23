import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

const SEVERITIES = ["info", "warn", "error", "critical"] as const;
const SEVERITY_BADGE: Record<(typeof SEVERITIES)[number], string> = {
  info: "cms-badge cms-badge-muted",
  warn: "cms-badge cms-badge-neutral",
  error: "cms-badge border-foreground/40 bg-background font-semibold",
  critical:
    "cms-badge border-destructive bg-destructive/10 text-destructive font-semibold",
};

export default function SystemErrorsLoading() {
  return (
    <>
      <PageHeader
        eyebrow="Λειτουργία"
        title="System errors"
        description="Ανοιχτά σφάλματα από Postgres functions. Ποιες reapers / atomic RPCs έχουν πρόβλημα — και πόσο συχνά."
      />

      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        {SEVERITIES.map((s) => (
          <span key={s} className={SEVERITY_BADGE[s]}>
            {s}
          </span>
        ))}
      </div>

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select disabled className="cms-input w-auto">
          <option value="">Όλες οι πηγές</option>
        </select>
        <select disabled className="cms-input w-auto">
          <option value="">Όλα τα severity</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select disabled className="cms-input w-auto">
          <option value="">Όλα</option>
          <option value="false">Ανοιχτά</option>
          <option value="true">Επιλυμένα</option>
        </select>
        <button type="submit" disabled className="btn btn-secondary btn-md">
          Φιλτράρισμα
        </button>
      </form>

      <StaticTableSkeleton
        columns={[
          { label: "Όταν" },
          { label: "Severity" },
          { label: "Source" },
          { label: "SQLSTATE" },
          { label: "Message" },
          { label: "Entity" },
          { label: "Status" },
          { label: "Ενέργειες", thClassName: "text-center" },
        ]}
        rowCount={10}
      />
    </>
  );
}
