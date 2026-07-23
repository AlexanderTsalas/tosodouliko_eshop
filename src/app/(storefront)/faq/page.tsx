import type { Metadata } from "next";
import Link from "next/link";
import InfoPageShell from "@/components/layout/InfoPageShell";
import { strings } from "@/config/strings";

export const metadata: Metadata = { title: strings.pages.faq.title };

const QA: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Πώς μπορώ να ακυρώσω μια παραγγελία;",
    a: (
      <>
        Μπορείτε να ακυρώσετε μια καταχωρημένη παραγγελία εντός 24 ωρών, στέλνοντας email στο{" "}
        <a href="mailto:info@tosodouliko.gr" className="text-terracotta hover:underline">
          info@tosodouliko.gr
        </a>{" "}
        (θέμα «Ακύρωση παραγγελίας» με τον αριθμό παραγγελίας) ή τηλεφωνικά στο 2810 244839. Μετά
        το πέρας των 24 ωρών δεν γίνεται δεκτή ακύρωση.
      </>
    ),
  },
  {
    q: "Μπορώ να αλλάξω ή να επιστρέψω ένα προϊόν;",
    a: (
      <>
        Ναι, εντός 14 εργάσιμων ημερών από την παραλαβή, εφόσον το προϊόν πληροί τις
        προϋποθέσεις (άθικτη συσκευασία, αφόρετο, με τις ετικέτες του). Δείτε αναλυτικά στη
        σελίδα{" "}
        <Link href="/returns" className="text-terracotta hover:underline">
          Επιστροφές &amp; Αλλαγές
        </Link>
        .
      </>
    ),
  },
  {
    q: "Ποιοι τρόποι πληρωμής υπάρχουν;",
    a: (
      <>
        Τραπεζική κατάθεση, πληρωμή με κάρτα (χρεωστική/πιστωτική/προπληρωμένη) και IRIS
        Payments. Δείτε λεπτομέρειες στη σελίδα{" "}
        <Link href="/shipping" className="text-terracotta hover:underline">
          Τρόποι Πληρωμής &amp; Αποστολής
        </Link>
        .
      </>
    ),
  },
  {
    q: "Πώς γίνεται η αποστολή και πόσο χρόνο παίρνει;",
    a: (
      <>
        Οι αποστολές γίνονται με την Speedex σε όλη την Ελλάδα. Για προϊόντα άμεσης
        διαθεσιμότητας η αποστολή γίνεται εντός 1–2 εργάσιμων ημερών· για προϊόντα κατόπιν
        παραγγελίας ο χρόνος γνωστοποιείται τηλεφωνικά κατά την επιβεβαίωση.
      </>
    ),
  },
  {
    q: "Πόσο κοστίζει η αποστολή;",
    a: <>Το κόστος αποστολής υπολογίζεται στο καλάθι και εμφανίζεται πριν την ολοκλήρωση της παραγγελίας.</>,
  },
];

export default function FaqPage() {
  return (
    <InfoPageShell title={strings.pages.faq.title}>
      <div className="divide-y divide-stone-taupe/15">
        {QA.map((item) => (
          <div key={item.q} className="py-4 first:pt-0">
            <h2 className="font-serif text-lg font-bold text-ink mb-1.5">{item.q}</h2>
            <p>{item.a}</p>
          </div>
        ))}
      </div>
    </InfoPageShell>
  );
}
