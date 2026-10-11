"use client";

import { MeetingShell } from "@/components/meetings/shell";
import { RecordPanel } from "@/components/meetings/record-panel";

export function HomeScreen() {
  return (
    <MeetingShell>
      <main id="main" className="px-4 py-10 md:px-8 md:py-16">
        <RecordPanel />
      </main>
    </MeetingShell>
  );
}
