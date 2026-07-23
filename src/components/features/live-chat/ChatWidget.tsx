"use client";

import { useState } from "react";

/**
 * Live chat widget placeholder. Backend wiring (chat_sessions/chat_messages
 * + Supabase Realtime channel) will be added once the chat provider is chosen.
 */
export default function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <div className="bg-background border rounded-lg shadow-lg w-80 h-96 flex flex-col">
          <header className="flex items-center justify-between border-b p-3">
            <h2 className="font-medium">Συνομιλία</h2>
            <button onClick={() => setOpen(false)} aria-label="Κλείσιμο">×</button>
          </header>
          <div className="flex-1 overflow-auto p-3 text-sm text-muted-foreground">
            Πώς μπορούμε να σας βοηθήσουμε;
          </div>
          <form className="border-t p-2 flex gap-2">
            <input
              type="text"
              placeholder="Μήνυμα..."
              className="flex-1 border rounded px-2 py-1 text-sm"
            />
            <button type="submit" className="rounded bg-primary text-primary-foreground px-3 text-sm">
              Αποστολή
            </button>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-lg"
        >
          Συνομιλία
        </button>
      )}
    </div>
  );
}
