export default function WishlistQueueLoading() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Λίστα αναμονής ειδοποιήσεων</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Πελάτες που περιμένουν ειδοποίηση για επιστροφή αποθέματος. Η
          καρτέλα <strong>Εκκρεμείς</strong> δείχνει αυτούς που πρέπει να
          ειδοποιήσετε χειροκίνητα (όταν επιστρέψει απόθεμα). Η καρτέλα{" "}
          <strong>Συνδρομητές</strong> δείχνει όλους όσοι έχουν εγγραφεί για
          ειδοποίηση από όπου κι αν προήλθε η εγγραφή.
        </p>
      </header>

      <section className="rounded border p-4 bg-muted/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">Λειτουργία ειδοποιήσεων λίστας επιθυμιών</h2>
            <p className="text-sm text-muted-foreground mt-1">
              <strong>Αυτόματα</strong>: το σύστημα στέλνει τις ειδοποιήσεις
              μόλις επιστρέψει απόθεμα.
              <br />
              <strong>Χειροκίνητα</strong>: οι ειδοποιήσεις μπαίνουν σε αυτή
              τη λίστα και επιβεβαιώνετε χειροκίνητα ποιες θα φύγουν.
            </p>
          </div>
          <div className="flex flex-col gap-2 min-w-[180px]">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="wishlist_mode" disabled />
              <span>Αυτόματα</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="wishlist_mode" disabled />
              <span>Χειροκίνητα</span>
            </label>
          </div>
        </div>
      </section>

      <div>
        <div className="cms-tabs" role="tablist">
          <span role="tab" aria-current="page" className="cms-tab">
            Εκκρεμείς ειδοποιήσεις
          </span>
          <span role="tab" className="cms-tab">
            Συνδρομητές αναμονής
          </span>
        </div>
      </div>
    </div>
  );
}
