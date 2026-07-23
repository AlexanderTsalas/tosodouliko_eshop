import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { brand } from "@/config/brand";
import { strings } from "@/config/strings";

export const metadata: Metadata = { title: strings.pages.about.title };

export default function AboutPage() {
  return (
    <main className="bg-transparent">
      {/* Hero */}
      <section className="relative h-[46vh] min-h-[320px] flex items-end overflow-hidden border-b border-stone-taupe/20">
        <Image
          src="/brand/hero-wedding-dance.png"
          alt={strings.pages.about.title}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/25 to-transparent" />
        <div className="relative container mx-auto px-4 pb-8 z-10">
          <p className="text-[11px] tracking-widest font-mono text-canvas/90 uppercase font-semibold mb-2">
            {brand.tagline}
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold text-canvas tracking-tight drop-shadow-md">
            {strings.pages.about.title}
          </h1>
        </div>
      </section>

      {/* Intro */}
      <section className="container mx-auto px-4 max-w-3xl py-14 text-center">
        <h2 className="font-serif text-2xl sm:text-3xl font-bold text-ink mb-6">
          Καλώς ήρθατε στο τοσοδούλικο
        </h2>
        <p className="text-ink/80 leading-relaxed">
          Από το 2025 δημιουργούμε μοναδικές προτάσεις για βάπτιση, γάμο και τις πιο ξεχωριστές
          οικογενειακές στιγμές. Με έμφαση στην ποιότητα, τη λεπτομέρεια και το διαχρονικό στυλ,
          προσφέρουμε χειροποίητα βαπτιστικά, παιδικά ρούχα και επιλεγμένα είδη γάμου που
          ξεχωρίζουν για την κομψότητα και την υψηλή αισθητική τους.
        </p>
        <p className="mt-4 text-ink/80 leading-relaxed">
          Κάθε δημιουργία επιλέγεται ή κατασκευάζεται με αγάπη και φροντίδα, ώστε να ανταποκρίνεται
          στις δικές σας επιθυμίες και να χαρίζει αξέχαστες αναμνήσεις. Στο τοσοδούλικο, πιστεύουμε
          ότι οι σημαντικές στιγμές της ζωής αξίζουν να ντύνονται με ποιότητα, φινέτσα και
          ξεχωριστό χαρακτήρα.
        </p>
        <p className="mt-4 text-ink/80 leading-relaxed">
          Σας καλωσορίζουμε στον κόσμο μας και θα χαρούμε να δημιουργήσουμε μαζί την πιο όμορφη
          εκδοχή της δικής σας ξεχωριστής ημέρας.
        </p>
      </section>

      {/* Closing CTA */}
      <section className="bg-warm-sand py-16 text-center border-t border-stone-taupe/20">
        <div className="container mx-auto px-4 max-w-2xl">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-ink">
            Ας γνωριστούμε από κοντά
          </h2>
          <p className="mt-3 text-ink/75 leading-relaxed">
            Θα χαρούμε να σας εξυπηρετήσουμε στο {brand.contact.phone} ή στο{" "}
            <a href={`mailto:${brand.contact.email}`} className="text-terracotta hover:underline">
              {brand.contact.email}
            </a>
            .
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 mt-6 bg-terracotta hover:bg-canvas hover:text-terracotta border border-terracotta text-canvas font-serif text-sm tracking-widest py-3 px-7 rounded-sm uppercase font-medium transition-colors"
          >
            <span>{strings.pages.contact.title}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
