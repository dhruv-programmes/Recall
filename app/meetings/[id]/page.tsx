import { Suspense } from "react";
import { MeetingScreen } from "@/components/meetings/meeting-screen";

export default function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <p className="px-8 py-8 text-sm text-muted-foreground">Loading meeting…</p>
      }
    >
      <ResolvedMeeting params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ResolvedMeeting({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  return (
    <MeetingScreen
      key={id}
      meetingId={id}
      initialTab={tab === "transcript" ? "transcript" : "summary"}
    />
  );
}
