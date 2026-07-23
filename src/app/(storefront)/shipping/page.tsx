import type { Metadata } from "next";
import InfoPageShell from "@/components/layout/InfoPageShell";
import { strings } from "@/config/strings";

export const metadata: Metadata = { title: strings.pages.shipping.title };

const H2 = "font-serif text-xl font-bold text-ink mt-8 mb-2";
const H3 = "font-serif text-base font-bold text-ink mt-5 mb-1";
const UL = "list-disc pl-5 space-y-1.5";

export default function ShippingPage() {
  return (
    <InfoPageShell title={strings.pages.shipping.title}>
      <p>
        Στο ηλεκτρονικό μας κατάστημα προσφέρουμε αξιόπιστους και ασφαλείς τρόπους πληρωμής και
        αποστολής, ώστε η διαδικασία αγοράς των προϊόντων βάπτισης, παιδικών ρούχων και
        υποδημάτων να είναι εύκολη και άνετη.
      </p>

      <h2 className={H2}>Τρόποι Πληρωμής</h2>
      <p>Οι διαθέσιμοι τρόποι εξόφλησης της παραγγελίας σας είναι οι εξής:</p>

      <h3 className={H3}>1. Τραπεζική Κατάθεση</h3>
      <p>
        Μπορείτε να ολοκληρώσετε την πληρωμή μέσω κατάθεσης σε τραπεζικό λογαριασμό. Παρακαλούμε
        αναγράψτε στο καταθετήριο το ονοματεπώνυμο ή τον αριθμό παραγγελίας. Μετά την κατάθεση,
        αποστείλετε το αποδεικτικό στο{" "}
        <a href="mailto:info@tosodouliko.gr" className="text-terracotta hover:underline">
          info@tosodouliko.gr
        </a>{" "}
        για την άμεση προώθηση της παραγγελίας.
      </p>
      <p className="font-mono text-sm bg-warm-sand/40 border border-stone-taupe/20 rounded-sm px-3 py-2 inline-block">
        Eurobank IBAN: GR5602602760000210202128935
      </p>

      <h3 className={H3}>2. Πληρωμή με Κάρτα</h3>
      <p>
        Γίνονται δεκτές όλες οι χρεωστικές, πιστωτικές και προπληρωμένες κάρτες μέσω ασφαλούς
        περιβάλλοντος συναλλαγών. Η διαδικασία πραγματοποιείται με κρυπτογράφηση και σύμφωνα με
        τα διεθνή πρότυπα ασφαλείας.
      </p>

      <h3 className={H3}>3. IRIS Payments</h3>
      <p>
        Μπορείτε να ολοκληρώσετε την πληρωμή σας άμεσα μέσω της υπηρεσίας IRIS, εύκολα και
        γρήγορα μέσα από το mobile banking της τράπεζάς σας.
      </p>

      <h2 className={H2}>Τρόποι Αποστολής</h2>
      <p>
        Η αποστολή των προϊόντων πραγματοποιείται με την εταιρεία ταχυμεταφορών Speedex, η οποία
        εξασφαλίζει αξιόπιστη και έγκαιρη παράδοση σε όλη την Ελλάδα.
      </p>

      <h3 className={H3}>Χρόνος Παράδοσης</h3>
      <p>Ο χρόνος παράδοσης διαφοροποιείται ανάλογα με τη διαθεσιμότητα των προϊόντων:</p>
      <ul className={UL}>
        <li>Άμεση Διαθεσιμότητα: Αποστολή εντός 1–2 εργάσιμων ημερών.</li>
        <li>
          Κατόπιν Παραγγελίας: Απαιτείται ο χρόνος που θα σας γνωστοποιηθεί τηλεφωνικά κατά την
          επιβεβαίωση της παραγγελίας.
        </li>
      </ul>

      <h3 className={H3}>Κόστος Αποστολής</h3>
      <p>
        Το κόστος αποστολής υπολογίζεται στο καλάθι αγορών και εμφανίζεται πριν την ολοκλήρωση
        της παραγγελίας.
      </p>

      <h2 className={H2}>Σημαντικές Πληροφορίες</h2>
      <ul className={UL}>
        <li>Σε περίπτωση καθυστέρησης ή αλλαγής διαθεσιμότητας από τους προμηθευτές, ενημερώνεστε άμεσα.</li>
        <li>Η επιχείρηση δεν φέρει ευθύνη για τυχόν καθυστερήσεις που οφείλονται στην εταιρεία ταχυμεταφορών.</li>
        <li>
          Για οποιαδήποτε διευκρίνιση σχετικά με την πληρωμή ή την αποστολή, μπορείτε να
          επικοινωνήσετε στο 2810 244839 ή στο{" "}
          <a href="mailto:info@tosodouliko.gr" className="text-terracotta hover:underline">
            info@tosodouliko.gr
          </a>
          .
        </li>
      </ul>
    </InfoPageShell>
  );
}
